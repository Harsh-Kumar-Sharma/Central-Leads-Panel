// PM2 process file for production.
//
//   npm run pm2:start     first start (then: npm run pm2:startup once, to survive reboots)
//   npm run pm2:reload    after a deploy (zero-config: start if missing, reload if running)
//   npm run pm2:logs      tail logs
//
// Secrets stay in backend/.env (NODE_ENV=production, strong JWT_SECRET, SECRET_ENCRYPTION_KEY,
// TRUST_PROXY=1 behind Nginx, HOST=127.0.0.1). PM2's env below only sets NODE_ENV.
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'central-leads-api',
      script: 'src/server.js',
      cwd: __dirname,
      // Keep ONE instance: rate-limit counters and live SSE connections live in memory.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      exp_backoff_restart_delay: 200, // back off if it crash-loops (e.g. DB unreachable)
      kill_timeout: 8000, // time for graceful shutdown (closes SSE streams, finishes requests)
      listen_timeout: 15000,
      time: true,
      merge_logs: true,
      out_file: path.join(__dirname, 'logs', 'out.log'),
      error_file: path.join(__dirname, 'logs', 'error.log'),
      env: { NODE_ENV: 'production' },
      env_production: { NODE_ENV: 'production' },
    },
  ],
};
