'use strict';
const mysql = require('mysql2/promise');
const env = require('./env');

const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  // Remote MySQL / firewalls silently drop idle sockets. Keep few idle connections,
  // close them early, and send TCP keep-alives so stale sockets are rare.
  maxIdle: 3,
  idleTimeout: 20000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: 10000,
  multipleStatements: false, // never allow stacked queries from the app
  timezone: env.DB_TZ_OFFSET,
  dateStrings: false,
  supportBigNumbers: true,
  bigNumberStrings: false,
  charset: 'utf8mb4',
});

// Every connection works in the configured TZ (IST) so date grouping (today / this week) matches the owner.
pool.pool.on('connection', (conn) => {
  conn.query('SET time_zone = ?', [env.DB_TZ_OFFSET]);
});

/**
 * If a pooled socket was dropped by the server, the first query on it fails with
 * ECONNRESET / PROTOCOL_CONNECTION_LOST. mysql2 discards that connection, so retrying
 * once gets a fresh one. Only read-only statements are retried (never a write that
 * might already have been applied).
 */
const TRANSIENT = new Set(['ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'EPIPE', 'ETIMEDOUT']);
const isRead = (sql) => /^\s*(SELECT|SHOW)\b/i.test(typeof sql === 'string' ? sql : sql?.sql || '');

for (const method of ['query', 'execute']) {
  const original = pool[method].bind(pool);
  pool[method] = async (sql, params) => {
    try {
      return await original(sql, params);
    } catch (err) {
      if (TRANSIENT.has(err.code) && isRead(sql)) {
        console.warn(`[db] ${err.code} on pooled connection, retrying once`);
        return original(sql, params);
      }
      throw err;
    }
  };
}

module.exports = pool;
