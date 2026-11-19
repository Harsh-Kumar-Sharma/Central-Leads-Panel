'use strict';
const db = require('../config/db');
const HttpError = require('../utils/httpError');
const { scopeClause } = require('../utils/scope');
const hub = require('./sseHub');

const parse = (v) => (v === null || v === undefined ? null : typeof v === 'string' ? JSON.parse(v) : v);
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * Users who should get an in-app notification for a lead of `siteId`:
 * active super admins + active users assigned to the site (same scoping as Phase 1),
 * filtered by each user's preferences (bell on, and the site is in their list or the list is "all").
 */
async function recipientsFor(siteId) {
  const [rows] = await db.execute(
    `SELECT u.id
     FROM users u
     LEFT JOIN user_notification_prefs p ON p.user_id = u.id
     WHERE u.is_active = 1
       AND (u.role = 'super_admin' OR EXISTS (SELECT 1 FROM user_sites us WHERE us.user_id = u.id AND us.site_id = ?))
       AND COALESCE(p.bell_enabled, 1) = 1
       AND (p.site_ids IS NULL OR JSON_CONTAINS(p.site_ids, CAST(? AS JSON)))`,
    [siteId, String(siteId)]
  );
  return rows.map((r) => r.id);
}

/** Creates notification rows for a new lead and pushes them live to connected users. */
exports.createForLead = async (leadId) => {
  const [[lead]] = await db.execute(
    `SELECT l.id, l.site_id, l.type, l.name, l.subject, l.message, l.status, l.created_at,
            s.name AS site_name, s.color AS site_color
     FROM leads l JOIN sites s ON s.id = l.site_id WHERE l.id = ?`,
    [leadId]
  );
  if (!lead || lead.status === 'spam') return 0;

  const typeWord = lead.type === 'quote' ? 'quote' : 'inquiry';
  const title = clip(`New ${typeWord} from ${lead.name}`, 255);
  const detail = lead.subject || lead.message;
  const body = clip(detail ? `${lead.site_name} · ${detail}` : lead.site_name, 500);

  const userIds = await recipientsFor(lead.site_id);
  for (const userId of userIds) {
    const [r] = await db.execute(
      'INSERT INTO notifications (user_id, lead_id, site_id, title, body) VALUES (?, ?, ?, ?, ?)',
      [userId, lead.id, lead.site_id, title, body]
    );
    hub.sendToUser(userId, 'new_lead', {
      notification_id: r.insertId,
      lead_id: lead.id,
      site_id: lead.site_id,
      site_name: lead.site_name,
      site_color: lead.site_color,
      type: lead.type,
      name: lead.name,
      title,
      body,
      created_at: new Date().toISOString(),
    });
  }
  return userIds.length;
};

// ---------------------------------------------------------------- reads (always site-scoped)
/** Only notifications of sites the user can still see are ever returned or counted. */
function userScope(user, allowed) {
  const scope = scopeClause(allowed, 'n.site_id');
  if (!scope) return null;
  return { sql: `n.user_id = ? AND ${scope.sql}`, params: [user.id, ...scope.params] };
}

exports.unreadCount = async (user, allowed) => {
  const w = userScope(user, allowed);
  if (!w) return 0;
  const [[{ c }]] = await db.execute(`SELECT COUNT(*) AS c FROM notifications n WHERE ${w.sql} AND n.is_read = 0`, w.params);
  return Number(c);
};

exports.list = async (user, allowed, { limit, unread_only }) => {
  const w = userScope(user, allowed);
  if (!w) return { data: [], unread_count: 0 };
  const [rows] = await db.execute(
    `SELECT n.id, n.lead_id, n.site_id, s.name AS site_name, s.color AS site_color, l.type, l.name,
            n.title, n.body, n.is_read, n.created_at
     FROM notifications n
     JOIN sites s ON s.id = n.site_id
     JOIN leads l ON l.id = n.lead_id
     WHERE ${w.sql} ${unread_only ? 'AND n.is_read = 0' : ''}
     ORDER BY n.id DESC
     LIMIT ${Number(limit)}`,
    w.params
  );
  return { data: rows.map((r) => ({ ...r, is_read: !!r.is_read })), unread_count: await exports.unreadCount(user, allowed) };
};

exports.markRead = async (user, allowed, id) => {
  const w = userScope(user, allowed);
  if (!w) throw new HttpError(404, 'Notification not found');
  const [[row]] = await db.execute(`SELECT n.id FROM notifications n WHERE n.id = ? AND ${w.sql}`, [id, ...w.params]);
  if (!row) throw new HttpError(404, 'Notification not found');
  await db.execute('UPDATE notifications SET is_read = 1 WHERE id = ?', [id]);
  return exports.unreadCount(user, allowed);
};

exports.markAllRead = async (user, allowed) => {
  const w = userScope(user, allowed);
  if (!w) return 0;
  await db.execute(`UPDATE notifications n SET n.is_read = 1 WHERE ${w.sql} AND n.is_read = 0`, w.params);
  return 0;
};

// ---------------------------------------------------------------- preferences
exports.getPrefs = async (user) => {
  const [[row]] = await db.execute('SELECT bell_enabled, site_ids FROM user_notification_prefs WHERE user_id = ?', [user.id]);
  return { bell_enabled: row ? !!row.bell_enabled : true, site_ids: row ? parse(row.site_ids) : null };
};

/** site_ids: null = all of my sites; otherwise must be a subset of the sites I can see. */
exports.savePrefs = async (user, allowed, { bell_enabled, site_ids }) => {
  let ids = null;
  if (Array.isArray(site_ids)) {
    ids = [...new Set(site_ids)];
    if (ids.length) {
      const [rows] = await db.execute(`SELECT id FROM sites WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
      const exists = new Set(rows.map((r) => r.id));
      const bad = ids.filter((id) => !exists.has(id) || (allowed !== null && !allowed.includes(id)));
      if (bad.length) throw new HttpError(400, 'You can only choose companies you have access to', { site_ids: 'Invalid company selection' });
    }
  }
  await db.execute(
    `INSERT INTO user_notification_prefs (user_id, bell_enabled, site_ids) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE bell_enabled = VALUES(bell_enabled), site_ids = VALUES(site_ids)`,
    [user.id, bell_enabled ? 1 : 0, ids === null ? null : JSON.stringify(ids)]
  );
  return exports.getPrefs(user);
};

// ---------------------------------------------------------------- housekeeping
async function cleanup() {
  const [r] = await db.execute('DELETE FROM notifications WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY) LIMIT 5000');
  if (r.affectedRows) console.log(`[notifications] removed ${r.affectedRows} notifications older than 90 days`);
  // Signed-out tokens only need to be remembered until they would have expired anyway.
  await db.execute('DELETE FROM revoked_tokens WHERE expires_at < NOW()');
}
let timer = null;
exports.start = () => {
  cleanup().catch((e) => console.error('[notifications] cleanup failed:', e.message));
  timer = setInterval(() => cleanup().catch((e) => console.error('[notifications] cleanup failed:', e.message)), 24 * 60 * 60 * 1000);
  timer.unref();
};
exports.stop = () => { if (timer) clearInterval(timer); timer = null; };
