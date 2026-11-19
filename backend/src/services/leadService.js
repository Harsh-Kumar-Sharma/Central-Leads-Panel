'use strict';
const db = require('../config/db');
const { notify } = require('./notify');

/** Builds a "site_id IN (...)" scope clause. Returns null when the user can see nothing. */
function scopeClause(allowedSiteIds, column = 'l.site_id') {
  if (allowedSiteIds === null) return { sql: '1=1', params: [] };
  if (!allowedSiteIds.length) return null;
  return { sql: `${column} IN (${allowedSiteIds.map(() => '?').join(',')})`, params: [...allowedSiteIds] };
}
exports.scopeClause = scopeClause;

const SORT_COLUMNS = { created_at: 'l.created_at', name: 'l.name', status: 'l.status', site: 's.name' };
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

/**
 * Turns validated filters + the user's allowed sites into a WHERE clause.
 * Returns null when the result is guaranteed empty (no sites visible).
 */
function buildWhere(f, allowed) {
  const where = [];
  const params = [];

  // Site scope: requested site_ids are always intersected with what the user may see.
  let siteIds = f.site_ids && f.site_ids.length ? [...new Set(f.site_ids)] : null;
  if (allowed !== null) siteIds = siteIds ? siteIds.filter((id) => allowed.includes(id)) : allowed;
  if (siteIds) {
    if (!siteIds.length) return null;
    where.push(`l.site_id IN (${siteIds.map(() => '?').join(',')})`);
    params.push(...siteIds);
  }

  if (f.type) { where.push('l.type = ?'); params.push(f.type); }

  if (f.status && f.status.length) {
    where.push(`l.status IN (${f.status.map(() => '?').join(',')})`);
    params.push(...f.status);
  } else {
    where.push("l.status <> 'spam'"); // spam hidden unless explicitly requested
  }

  if (f.from) { where.push('l.created_at >= ?'); params.push(`${f.from} 00:00:00`); }
  if (f.to) { where.push('l.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(`${f.to} 00:00:00`); }

  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    where.push('(l.name LIKE ? OR l.email LIKE ? OR l.phone LIKE ? OR l.message LIKE ? OR l.subject LIKE ? OR l.company LIKE ?)');
    params.push(like, like, like, like, like, like);
  }
  return { sql: where.length ? where.join(' AND ') : '1=1', params };
}

function orderBy(f) {
  const col = SORT_COLUMNS[f.sort] || 'l.created_at';
  const dir = f.order === 'asc' ? 'ASC' : 'DESC';
  return `${col} ${dir}, l.id ${dir}`;
}

exports.list = async (f, allowed) => {
  const w = buildWhere(f, allowed);
  if (!w) return { data: [], total: 0, page: f.page, page_size: f.page_size };
  const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM leads l WHERE ${w.sql}`, w.params);
  // LIMIT/OFFSET are validated integers from zod, safe to inline.
  const limit = Number(f.page_size);
  const offset = (Number(f.page) - 1) * limit;
  const [rows] = await db.execute(
    `SELECT l.id, l.site_id, s.name AS site_name, s.color AS site_color, l.type, l.name, l.email, l.phone,
            l.subject, l.company, LEFT(l.message, 120) AS message_preview, l.status, l.is_read, l.created_at
     FROM leads l JOIN sites s ON s.id = l.site_id
     WHERE ${w.sql}
     ORDER BY ${orderBy(f)}
     LIMIT ${limit} OFFSET ${offset}`,
    w.params
  );
  return { data: rows, total: Number(total), page: f.page, page_size: f.page_size };
};

exports.EXPORT_MAX_ROWS = 50000;
exports.listForExport = async (f, allowed) => {
  const w = buildWhere(f, allowed);
  if (!w) return [];
  const [rows] = await db.execute(
    `SELECT l.id, s.name AS site_name, l.type, l.name, l.email, l.phone, l.subject, l.company, l.message,
            l.extra, l.status, l.source_url, l.created_at
     FROM leads l JOIN sites s ON s.id = l.site_id
     WHERE ${w.sql}
     ORDER BY ${orderBy(f)}
     LIMIT ${exports.EXPORT_MAX_ROWS}`,
    w.params
  );
  return rows;
};

/** Fetches one lead only if it belongs to an allowed site; otherwise null (caller returns 404). */
async function findScoped(id, allowed, columns = 'l.id') {
  const scope = scopeClause(allowed);
  if (!scope) return null;
  const [rows] = await db.execute(
    `SELECT ${columns} FROM leads l JOIN sites s ON s.id = l.site_id WHERE l.id = ? AND ${scope.sql} LIMIT 1`,
    [id, ...scope.params]
  );
  return rows[0] || null;
}

exports.getDetail = async (id, allowed) => {
  const lead = await findScoped(
    id, allowed,
    `l.id, l.site_id, s.name AS site_name, s.color AS site_color, s.domain AS site_domain, l.type, l.name, l.email,
     l.phone, l.subject, l.company, l.message, l.extra, l.raw_payload, l.source_url, l.ip, l.user_agent,
     l.status, l.is_read, l.created_at, l.updated_at`
  );
  if (!lead) return null;
  if (!lead.is_read) {
    await db.execute('UPDATE leads SET is_read = 1 WHERE id = ?', [id]);
    lead.is_read = 1;
  }
  lead.notes = await listNotes(id);
  return lead;
};

async function listNotes(leadId) {
  const [rows] = await db.execute(
    `SELECT n.id, n.note, n.created_at, u.id AS user_id, u.name AS user_name
     FROM lead_notes n JOIN users u ON u.id = n.user_id
     WHERE n.lead_id = ? ORDER BY n.created_at DESC, n.id DESC`,
    [leadId]
  );
  return rows;
}

exports.updateStatus = async (id, status, allowed) => {
  const lead = await findScoped(id, allowed);
  if (!lead) return false;
  await db.execute('UPDATE leads SET status = ? WHERE id = ?', [status, id]);
  return true;
};

exports.addNote = async (id, note, user, allowed) => {
  const lead = await findScoped(id, allowed);
  if (!lead) return null;
  const [r] = await db.execute('INSERT INTO lead_notes (lead_id, user_id, note) VALUES (?, ?, ?)', [id, user.id, note]);
  const [[row]] = await db.execute(
    `SELECT n.id, n.note, n.created_at, u.id AS user_id, u.name AS user_name
     FROM lead_notes n JOIN users u ON u.id = n.user_id WHERE n.id = ?`,
    [r.insertId]
  );
  return row;
};

exports.createLead = async ({ siteId, data, rawBody, meta, isSpam }) => {
  const extra = data.extra && Object.keys(data.extra).length ? JSON.stringify(data.extra) : null;
  const [r] = await db.execute(
    `INSERT INTO leads (site_id, type, name, email, phone, subject, company, message, extra, raw_payload,
       source_url, ip, user_agent, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      siteId, data.type, data.name, data.email ?? null, data.phone ?? null, data.subject ?? null,
      data.company ?? null, data.message ?? null, extra, JSON.stringify(rawBody ?? {}),
      meta.source_url ?? null, meta.ip ?? null, meta.user_agent ?? null, isSpam ? 'spam' : 'new',
    ]
  );
  const lead = { id: r.insertId, site_id: siteId, ...data, status: isSpam ? 'spam' : 'new' };
  if (!isSpam) notify(lead).catch((e) => console.error('[notify] failed:', e.message));
  return r.insertId;
};
