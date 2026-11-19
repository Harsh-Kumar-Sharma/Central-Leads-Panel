'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DB_HOST: z.string().min(1).default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().min(1).default('central_leads'),
  JWT_SECRET: z.string().min(1),
  JWT_EXPIRES_IN: z.string().default('12h'),
  CORS_PANEL_ORIGIN: z.string().default('http://localhost:5180'),
  TRUST_PROXY: z.string().default('0'),
  HOST: z.string().default('127.0.0.1'),
  SEED_ADMIN_NAME: z.string().default('Super Admin'),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  TZ: z.string().default('Asia/Kolkata'),
  SECRET_ENCRYPTION_KEY: z.string().optional(),
  APP_BASE_URL: z.string().url().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const env = parsed.data;

const WEAK_SECRETS = ['change-me', 'secret', 'changeme', 'jwt-secret'];
if (env.JWT_SECRET.length < 32 || WEAK_SECRETS.includes(env.JWT_SECRET)) {
  if (env.NODE_ENV === 'production') {
    console.error('JWT_SECRET is too weak. Use at least 32 random characters in production.');
    process.exit(1);
  }
  console.warn('[warn] JWT_SECRET is weak. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
}

env.CORS_PANEL_ORIGINS = env.CORS_PANEL_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);

// 32-byte key for AES-256-GCM (SMTP passwords). Accepts 64 hex chars or base64.
function parseKey(raw) {
  if (!raw) return null;
  const s = raw.trim();
  const buf = /^[0-9a-fA-F]{64}$/.test(s) ? Buffer.from(s, 'hex') : Buffer.from(s, 'base64');
  return buf.length === 32 ? buf : null;
}
env.ENCRYPTION_KEY = parseKey(env.SECRET_ENCRYPTION_KEY);
if (!env.ENCRYPTION_KEY) {
  const msg = 'SECRET_ENCRYPTION_KEY must be 32 bytes (64 hex chars). Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"';
  if (env.NODE_ENV === 'production') {
    console.error(msg);
    process.exit(1);
  }
  console.warn(`[warn] ${msg}. SMTP passwords cannot be saved until it is set.`);
}
// MySQL session offset derived from TZ (one source of truth for "today"/"this week" grouping).
function tzOffset(tz) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(new Date()).find((p) => p.type === 'timeZoneName').value; // "GMT+05:30"
    const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(part);
    return m ? `${m[1]}:${m[2] || '00'}` : '+00:00';
  } catch { return '+00:00'; }
}
env.DB_TZ_OFFSET = tzOffset(env.TZ);
// Used for "View lead" links in emails.
env.APP_BASE_URL = (env.APP_BASE_URL || env.CORS_PANEL_ORIGINS[0] || 'http://localhost:5180').replace(/\/+$/, '');
// TRUST_PROXY: "0"/"false" = off, a number = hop count, otherwise passed as-is (e.g. "loopback")
const tp = env.TRUST_PROXY.trim().toLowerCase();
env.TRUST_PROXY_VALUE = tp === '0' || tp === 'false' ? false : /^\d+$/.test(tp) ? Number(tp) : env.TRUST_PROXY;
if (env.NODE_ENV === 'production' && env.TRUST_PROXY_VALUE === false) {
  console.warn('[warn] TRUST_PROXY=0 in production. Behind Nginx set TRUST_PROXY=1, otherwise every visitor shares one IP for rate limits.');
}

module.exports = env;
