'use strict';
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const env = require('../src/config/env');

(async () => {
  const conn = await mysql.createConnection({
    host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD,
    database: env.DB_NAME, multipleStatements: true, // only the trusted migration runner uses this
  });
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(200) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    const [done] = await conn.query('SELECT name FROM schema_migrations');
    const applied = new Set(done.map((r) => r.name));
    const dir = path.resolve(__dirname, '../migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (applied.has(f)) { console.log(`skip  ${f}`); continue; }
      await conn.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await conn.execute('INSERT INTO schema_migrations (name) VALUES (?)', [f]);
      console.log(`apply ${f}`);
    }
    console.log('Migrations complete.');
  } finally {
    await conn.end();
  }
})().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
