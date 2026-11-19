'use strict';
const env = require('./config/env');

process.env.TZ = env.TZ;

const app = require('./app');
const db = require('./config/db');

(async () => {
  try {
    await db.query('SELECT 1');
  } catch (e) {
    console.error('Cannot connect to MySQL:', e.message);
    process.exit(1);
  }
  const server = app.listen(env.PORT, () => console.log(`Central Leads API listening on http://localhost:${env.PORT}`));
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${env.PORT} is already in use.` : `Server error: ${err.message}`);
    process.exit(1);
  });
  server.headersTimeout = 20000;
  server.requestTimeout = 30000;
  const shutdown = () => server.close(() => db.end().finally(() => process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
})();
