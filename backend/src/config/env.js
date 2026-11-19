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
  SEED_ADMIN_NAME: z.string().default('Super Admin'),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  TZ: z.string().default('Asia/Kolkata'),
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
// TRUST_PROXY: "0"/"false" = off, a number = hop count, otherwise passed as-is (e.g. "loopback")
const tp = env.TRUST_PROXY.trim().toLowerCase();
env.TRUST_PROXY_VALUE = tp === '0' || tp === 'false' ? false : /^\d+$/.test(tp) ? Number(tp) : env.TRUST_PROXY;

module.exports = env;
