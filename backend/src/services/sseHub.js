'use strict';
const db = require('../config/db');

/**
 * In-memory registry of live Server-Sent-Event connections: user_id -> Set<client>.
 * Works because the API runs as a single process (PM2 instances: 1).
 */
const HEARTBEAT_MS = 25 * 1000;
const MAX_PER_USER = 5; // a few tabs/devices per user
const MAX_TOTAL = 500;

const clients = new Map(); // userId -> Set<{ res, tv, exp, jti }>
let total = 0;

function write(res, chunk) {
  try { res.write(chunk); return true; } catch { return false; }
}

function remove(userId, client) {
  const set = clients.get(userId);
  if (!set || !set.delete(client)) return;
  total -= 1;
  if (!set.size) clients.delete(userId);
}

function endClient(userId, c) {
  write(c.res, 'event: session_ended\ndata: {}\n\n');
  remove(userId, c);
  try { c.res.end(); } catch { /* ignore */ }
}

/**
 * Registers a connection. Returns false when limits are reached: the new stream is refused
 * (503) rather than evicting an older one, otherwise 6+ open tabs would keep kicking each
 * other off. A refused tab falls back to polling the unread count.
 */
exports.add = (userId, res, { tv, exp, jti }) => {
  const set = clients.get(userId) || new Set();
  if (total >= MAX_TOTAL || set.size >= MAX_PER_USER) return false;
  const client = { res, tv, exp, jti };
  set.add(client);
  clients.set(userId, set);
  total += 1;
  res.on('close', () => remove(userId, client));
  return true;
};

/** Sends a named event with JSON data to every open connection of a user. */
exports.sendToUser = (userId, event, data) => {
  const set = clients.get(userId);
  if (!set) return 0;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let n = 0;
  for (const c of [...set]) {
    if (write(c.res, payload)) n += 1;
    else remove(userId, c);
  }
  return n;
};

exports.isOnline = (userId) => clients.has(userId);
exports.stats = () => ({ users: clients.size, connections: total });

/**
 * Re-validates open streams (all, or only the given users): user still active, same
 * token_version (password not changed), token not expired and not signed out.
 * With ping=true it also writes the keep-alive comment.
 */
async function validate(onlyUserIds = null, ping = false) {
  const ids = (onlyUserIds || [...clients.keys()]).filter((id) => clients.has(id));
  if (!ids.length) return;
  const [rows] = await db.execute(
    `SELECT id, is_active, token_version FROM users WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  const jtis = ids.flatMap((id) => [...clients.get(id)].map((c) => c.jti).filter(Boolean));
  let revokedSet = new Set();
  if (jtis.length) {
    const [revoked] = await db.execute(`SELECT jti FROM revoked_tokens WHERE jti IN (${jtis.map(() => '?').join(',')})`, jtis);
    revokedSet = new Set(revoked.map((r) => r.jti));
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const now = Math.floor(Date.now() / 1000);
  for (const userId of ids) {
    const u = byId.get(userId);
    for (const c of [...(clients.get(userId) || [])]) {
      const valid = u && u.is_active && u.token_version === c.tv && (!c.exp || c.exp > now) && !revokedSet.has(c.jti);
      if (!valid) endClient(userId, c);
      else if (ping && !write(c.res, `: ping ${now}\n\n`)) remove(userId, c);
    }
  }
}

/** Immediately re-check some users' streams (after deactivation, password change or reset). */
exports.recheckUsers = (userIds) => {
  validate(userIds).catch((e) => console.error('[sse] recheck failed:', e.message));
};

/** Immediately end every stream opened with a signed-out token. */
exports.closeToken = (jti) => {
  for (const [userId, set] of clients) for (const c of [...set]) if (c.jti === jti) endClient(userId, c);
};

let timer = null;
exports.start = () => {
  timer = setInterval(() => validate(null, true).catch((e) => console.error('[sse] heartbeat failed:', e.message)), HEARTBEAT_MS);
  timer.unref();
};
exports.stop = () => {
  if (timer) clearInterval(timer);
  timer = null;
  for (const set of clients.values()) for (const c of set) { try { c.res.end(); } catch { /* ignore */ } }
  clients.clear();
  total = 0;
};
