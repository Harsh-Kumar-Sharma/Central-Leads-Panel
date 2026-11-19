'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const env = require('./config/env');
const { globalLimiter } = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
app.disable('x-powered-by');
// Set TRUST_PROXY=1 behind Nginx so req.ip is the real client IP (rate limits depend on it).
app.set('trust proxy', env.TRUST_PROXY_VALUE);
app.set('etag', false);

app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: env.NODE_ENV === 'production',
}));
app.use(globalLimiter);
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- Public ingest API: its own strict per-site CORS, never the panel's CORS ----
app.use('/api/v1', express.json({ limit: '100kb', strict: true }), require('./routes/ingest'));

// ---- Dashboard API: CORS locked to the panel origin(s) only ----
const panelCors = cors({
  origin: (origin, cb) => cb(null, origin && env.CORS_PANEL_ORIGINS.includes(origin) ? origin : false),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600,
});
const dashboard = express.Router();
dashboard.use(panelCors, express.json({ limit: '100kb', strict: true }));
// (No hpp: on Express 5 it cannot modify req.query; repeated params are handled by the zod schemas.)
dashboard.use('/auth', require('./routes/auth'));
dashboard.use('/stats', require('./routes/stats'));
dashboard.use('/leads', require('./routes/leads'));
dashboard.use('/notifications', require('./routes/notifications'));
dashboard.use('/admin', require('./routes/admin'));
dashboard.use('/admin', require('./routes/adminNotifications'));
dashboard.use('/sites', require('./routes/sites'));
app.use('/api', dashboard);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
