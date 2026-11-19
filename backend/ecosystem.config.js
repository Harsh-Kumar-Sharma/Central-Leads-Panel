// PM2 process file for production.
//   cd backend && npm ci --omit=dev && npm run migrate
//   pm2 start ecosystem.config.js && pm2 save
// Secrets stay in backend/.env (NODE_ENV=production, strong JWT_SECRET, TRUST_PROXY=1 behind Nginx).
module.exports = {
  apps: [
    {
      name: 'central-leads-api',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1, // rate-limit counters are in memory; use 1 instance (or add a shared store before scaling)
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production' },
      time: true,
      merge_logs: true,
    },
  ],
};
