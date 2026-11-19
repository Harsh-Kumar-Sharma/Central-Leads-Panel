'use strict';
const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const HttpError = require('../utils/httpError');
const { requireAuth, requireRole } = require('../middleware/auth');
const { generateApiKey } = require('../utils/apiKey');
const { idParam } = require('../validators/leadQuery');
const { siteBody, userCreate, userUpdate } = require('../validators/adminSchemas');
const hub = require('../services/sseHub');

const router = express.Router();
router.use(requireAuth, requireRole('super_admin'));

const parseOrigins = (v) => (Array.isArray(v) ? v : v ? JSON.parse(v) : []);

// ---------------- Sites ----------------
async function getSite(id) {
  const [[s]] = await db.execute(
    `SELECT s.id, s.name, s.domain, s.color, s.api_key, s.allowed_origins, s.is_active, s.created_at,
            (SELECT COUNT(*) FROM leads l WHERE l.site_id = s.id) AS lead_count
     FROM sites s WHERE s.id = ?`,
    [id]
  );
  if (!s) return null;
  return { ...s, allowed_origins: parseOrigins(s.allowed_origins), is_active: !!s.is_active, lead_count: Number(s.lead_count) };
}

router.get('/sites', asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    `SELECT s.id, s.name, s.domain, s.color, s.api_key, s.allowed_origins, s.is_active, s.created_at,
            COUNT(l.id) AS lead_count
     FROM sites s LEFT JOIN leads l ON l.site_id = s.id
     GROUP BY s.id ORDER BY s.name`
  );
  res.json(rows.map((s) => ({ ...s, allowed_origins: parseOrigins(s.allowed_origins), is_active: !!s.is_active, lead_count: Number(s.lead_count) })));
}));

router.post('/sites', asyncHandler(async (req, res) => {
  const b = siteBody.parse(req.body);
  const [r] = await db.execute(
    'INSERT INTO sites (name, domain, color, api_key, allowed_origins, is_active) VALUES (?, ?, ?, ?, ?, ?)',
    [b.name, b.domain, b.color, generateApiKey(), JSON.stringify(b.allowed_origins), b.is_active ? 1 : 0]
  );
  res.status(201).json(await getSite(r.insertId));
}));

router.put('/sites/:id', asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const b = siteBody.parse(req.body);
  const [r] = await db.execute(
    'UPDATE sites SET name = ?, domain = ?, color = ?, allowed_origins = ?, is_active = ? WHERE id = ?',
    [b.name, b.domain, b.color, JSON.stringify(b.allowed_origins), b.is_active ? 1 : 0, id]
  );
  if (!r.affectedRows) throw new HttpError(404, 'Site not found');
  res.json(await getSite(id));
}));

// The old key stops working immediately because lookups are by exact key.
router.post('/sites/:id/regenerate-key', asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const [r] = await db.execute('UPDATE sites SET api_key = ? WHERE id = ?', [generateApiKey(), id]);
  if (!r.affectedRows) throw new HttpError(404, 'Site not found');
  res.json(await getSite(id));
}));

// ---------------- Users ----------------
const USER_COLS = 'u.id, u.name, u.email, u.role, u.is_active, u.last_login_at, u.created_at';

async function getUser(id) {
  const [[u]] = await db.execute(`SELECT ${USER_COLS} FROM users u WHERE u.id = ?`, [id]);
  if (!u) return null;
  const [sites] = await db.execute('SELECT site_id FROM user_sites WHERE user_id = ? ORDER BY site_id', [id]);
  return { ...u, is_active: !!u.is_active, site_ids: sites.map((s) => s.site_id) };
}

async function assertSitesExist(ids) {
  if (!ids.length) return;
  const [rows] = await db.execute(`SELECT id FROM sites WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  if (rows.length !== new Set(ids).size) throw new HttpError(400, 'One or more sites do not exist', { site_ids: 'One or more sites do not exist' });
}

async function setUserSites(conn, userId, role, siteIds) {
  await conn.execute('DELETE FROM user_sites WHERE user_id = ?', [userId]);
  if (role === 'super_admin') return; // super admin sees everything; assignments are ignored
  for (const sid of new Set(siteIds)) {
    await conn.execute('INSERT INTO user_sites (user_id, site_id) VALUES (?, ?)', [userId, sid]);
  }
}

const isDup = (e) => e && e.code === 'ER_DUP_ENTRY';

router.get('/users', asyncHandler(async (req, res) => {
  const [users] = await db.query(`SELECT ${USER_COLS} FROM users u ORDER BY u.name`);
  const [links] = await db.query('SELECT user_id, site_id FROM user_sites');
  const map = new Map();
  for (const l of links) {
    if (!map.has(l.user_id)) map.set(l.user_id, []);
    map.get(l.user_id).push(l.site_id);
  }
  res.json(users.map((u) => ({ ...u, is_active: !!u.is_active, site_ids: map.get(u.id) || [] })));
}));

router.post('/users', asyncHandler(async (req, res) => {
  const b = userCreate.parse(req.body);
  await assertSitesExist(b.site_ids);
  const hash = await bcrypt.hash(b.password, 12);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.execute(
      'INSERT INTO users (name, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?)',
      [b.name, b.email, hash, b.role, b.is_active ? 1 : 0]
    );
    await setUserSites(conn, r.insertId, b.role, b.site_ids);
    await conn.commit();
    res.status(201).json(await getUser(r.insertId));
  } catch (e) {
    await conn.rollback();
    if (isDup(e)) throw new HttpError(409, 'A user with this email already exists', { email: 'A user with this email already exists' });
    throw e;
  } finally {
    conn.release();
  }
}));

router.put('/users/:id', asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const b = userUpdate.parse(req.body);
  const existing = await getUser(id);
  if (!existing) throw new HttpError(404, 'User not found');

  // Prevent locking yourself out.
  if (id === req.user.id && (b.role !== 'super_admin' || !b.is_active)) {
    throw new HttpError(400, 'You cannot remove your own super admin access or deactivate yourself');
  }
  // Always keep at least one active super admin.
  if (existing.role === 'super_admin' && existing.is_active && (b.role !== 'super_admin' || !b.is_active)) {
    const [[{ c }]] = await db.execute("SELECT COUNT(*) AS c FROM users WHERE role = 'super_admin' AND is_active = 1 AND id <> ?", [id]);
    if (Number(c) === 0) throw new HttpError(400, 'At least one active super admin is required');
  }
  await assertSitesExist(b.site_ids);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const sets = ['name = ?', 'role = ?', 'is_active = ?'];
    const params = [b.name, b.role, b.is_active ? 1 : 0];
    if (b.email) { sets.push('email = ?'); params.push(b.email); }
    if (b.password) {
      sets.push('password_hash = ?', 'token_version = token_version + 1'); // logs the user out everywhere
      params.push(await bcrypt.hash(b.password, 12));
    }
    params.push(id);
    await conn.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
    await setUserSites(conn, id, b.role, b.site_ids);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    if (isDup(e)) throw new HttpError(409, 'A user with this email already exists', { email: 'A user with this email already exists' });
    throw e;
  } finally {
    conn.release();
  }
  hub.recheckUsers([id]); // deactivated / password reset -> live streams closed now, not at next heartbeat
  res.json(await getUser(id));
}));

module.exports = router;
