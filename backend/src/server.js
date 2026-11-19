'use strict';
const env = require('./config/env');

process.env.TZ = env.TZ;

const app = require('./app');
const db = require('./config/db');
const emailService = require('./services/emailService');
const notificationService = require('./services/notificationService');
const sseHub = require('./services/sseHub');

(async () => {
  try {
    await db.query('SELECT 1');
  } catch (e) {
    console.error('Cannot connect to MySQL:', e.message);
    process.exit(1);
  }
  // Bind to localhost by default: only Nginx (same machine) should reach the API port.
  const server = app.listen(env.PORT, env.HOST, () => console.log(`Central Leads API listening on http://${env.HOST}:${env.PORT}`));
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${env.PORT} is already in use.` : `Server error: ${err.message}`);
    process.exit(1);
  });
  server.headersTimeout = 20000;
  server.requestTimeout = 30000;
  // Email retry queue: recover pending/retrying emails left from before a restart, then check every minute.
  emailService.start();
  // Live notification streams (heartbeat + session re-check) and the daily 90-day cleanup.
  sseHub.start();
  notificationService.start();
  const shutdown = () => {
    emailService.stop();
    notificationService.stop();
    sseHub.stop(); // end open SSE streams, otherwise server.close() would wait for them
    server.close(() => db.end().finally(() => process.exit(0)));
    server.closeIdleConnections();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
})();
