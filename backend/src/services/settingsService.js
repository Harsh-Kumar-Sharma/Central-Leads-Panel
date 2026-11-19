'use strict';
const db = require('../config/db');
const { encrypt } = require('../utils/crypto');
const HttpError = require('../utils/httpError');
const env = require('../config/env');

/**
 * The saved (encrypted) password may only be reused for the SAME server + account.
 * Otherwise a changed host would make us log in to an arbitrary server with the real password.
 */
const sameServer = (a, b) => !!a && !!b && String(a.host || '').toLowerCase() === String(b.host || '').toLowerCase()
  && Number(a.port) === Number(b.port) && String(a.username || '') === String(b.username || '');
exports.sameServer = sameServer;

/** Blocks SMTP hosts that point at the server itself / cloud metadata (SSRF). Loopback is allowed in development only. */
exports.assertAllowedHost = (host) => {
  const h = String(host || '').toLowerCase();
  if (!h) return;
  const loopback = h === 'localhost' || /^127\.\d+\.\d+\.\d+$/.test(h) || h === '::1';
  const linkLocalOrAny = /^169\.254\.\d+\.\d+$/.test(h) || /^0\.\d+\.\d+\.\d+$/.test(h);
  if (linkLocalOrAny || (loopback && env.NODE_ENV === 'production')) {
    throw new HttpError(400, 'This SMTP host is not allowed', { host: 'This SMTP host is not allowed' });
  }
};
const PW_REQUIRED = () => new HttpError(400, 'Enter the password again: the server or username changed', { password: 'Enter the password again: the server or username changed' });

const parse = (v) => (v === null || v === undefined ? null : typeof v === 'string' ? JSON.parse(v) : v);
const listeners = new Set();
/** Called whenever SMTP settings change (email service clears its transporter cache). */
exports.onChange = (fn) => listeners.add(fn);
const changed = () => listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });

async function getSetting(key) {
  const [[row]] = await db.execute('SELECT value FROM settings WHERE `key` = ?', [key]);
  return row ? parse(row.value) : null;
}
async function putSetting(key, value) {
  await db.execute(
    'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [key, JSON.stringify(value)]
  );
}

const DEFAULT_SMTP = { host: '', port: 587, secure: false, username: '', from_name: '', from_email: '' };

/** Strips the encrypted password before anything leaves the server. */
const publicSmtp = (c) => {
  if (!c) return null;
  const { password_enc, ...rest } = c;
  return { ...rest, has_password: !!password_enc };
};
exports.publicSmtp = publicSmtp;

// ---------------- Global SMTP ----------------
/** Raw config including password_enc (server-side use only). */
exports.getGlobalSmtpRaw = async () => getSetting('smtp_global');

exports.getGlobalSmtp = async () => publicSmtp((await getSetting('smtp_global')) || { enabled: false, ...DEFAULT_SMTP });

exports.saveGlobalSmtp = async (input) => {
  const current = (await getSetting('smtp_global')) || {};
  const { password, ...fields } = input;
  exports.assertAllowedHost(fields.host);
  const keep = sameServer(current, fields) ? current.password_enc : null;
  if (!password && current.password_enc && !keep && fields.enabled) throw PW_REQUIRED();
  const password_enc = password ? encrypt(password) : keep || null;
  if (fields.enabled && !password_enc) {
    throw new HttpError(400, 'Password is required', { password: 'Password is required' });
  }
  const value = { ...fields, password_enc };
  await putSetting('smtp_global', value);
  changed();
  return publicSmtp(value);
};

// ---------------- Global recipients ----------------
exports.getGlobalRecipients = async () => (await getSetting('global_recipients')) || [];
exports.saveGlobalRecipients = async (list) => {
  await putSetting('global_recipients', list);
  return list;
};

// ---------------- Per-site SMTP ----------------
exports.getSiteSmtpRaw = async (siteId) => {
  const [[row]] = await db.execute(
    'SELECT site_id, is_enabled, host, port, secure, username, password_enc, from_name, from_email, updated_at FROM site_smtp WHERE site_id = ?',
    [siteId]
  );
  return row ? { ...row, is_enabled: !!row.is_enabled, secure: !!row.secure } : null;
};

exports.getSiteSmtp = async (siteId) => {
  const row = await exports.getSiteSmtpRaw(siteId);
  return publicSmtp(row || { site_id: siteId, is_enabled: false, ...DEFAULT_SMTP, password_enc: null });
};

exports.saveSiteSmtp = async (siteId, input) => {
  const current = await exports.getSiteSmtpRaw(siteId);
  const { password, ...f } = input;
  exports.assertAllowedHost(f.host);
  const keep = sameServer(current, f) ? current.password_enc : '';
  if (!password && current?.password_enc && !keep && f.is_enabled) throw PW_REQUIRED();
  const password_enc = password ? encrypt(password) : keep;
  if (f.is_enabled && !password_enc) {
    throw new HttpError(400, 'Password is required', { password: 'Password is required' });
  }
  // Turning it off with nothing saved yet: nothing to store.
  if (!f.is_enabled && !current && !f.host) return exports.getSiteSmtp(siteId);
  await db.execute(
    `INSERT INTO site_smtp (site_id, is_enabled, host, port, secure, username, password_enc, from_name, from_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), host = VALUES(host), port = VALUES(port), secure = VALUES(secure),
       username = VALUES(username), password_enc = VALUES(password_enc), from_name = VALUES(from_name), from_email = VALUES(from_email)`,
    [siteId, f.is_enabled ? 1 : 0, f.host, f.port, f.secure ? 1 : 0, f.username, password_enc, f.from_name, f.from_email]
  );
  changed();
  return exports.getSiteSmtp(siteId);
};

// ---------------- Per-site recipients ----------------
exports.getSiteRecipients = async (siteId) => {
  const [rows] = await db.execute('SELECT id, email, mode, is_active FROM site_recipients WHERE site_id = ? ORDER BY id', [siteId]);
  return rows.map((r) => ({ ...r, is_active: !!r.is_active }));
};

exports.saveSiteRecipients = async (siteId, list) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM site_recipients WHERE site_id = ?', [siteId]);
    for (const r of list) {
      await conn.execute('INSERT INTO site_recipients (site_id, email, mode, is_active) VALUES (?, ?, ?, ?)', [siteId, r.email, r.mode, r.is_active ? 1 : 0]);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return exports.getSiteRecipients(siteId);
};

exports.siteExists = async (siteId) => {
  const [[row]] = await db.execute('SELECT id, name FROM sites WHERE id = ?', [siteId]);
  return row || null;
};
