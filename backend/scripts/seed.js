'use strict';
const bcrypt = require('bcrypt');
const env = require('../src/config/env');
const db = require('../src/config/db');
const { generateApiKey } = require('../src/utils/apiKey');

const DEMO_SITES = [
  { name: 'Skyline Aviation', domain: 'skylineaviation.example', color: '#6366F1' },
  { name: 'GreenBuild Infra', domain: 'greenbuild.example', color: '#10B981' },
  { name: 'Nova Interiors', domain: 'novainteriors.example', color: '#F59E0B' },
];

(async () => {
  const { SEED_ADMIN_EMAIL: email, SEED_ADMIN_PASSWORD: password, SEED_ADMIN_NAME: name } = env;
  if (!email || !password) throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env');
  if (password.length < 8) throw new Error('SEED_ADMIN_PASSWORD must be at least 8 characters');

  const [existing] = await db.execute('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
  if (existing.length) {
    console.log(`Super admin ${email} already exists, skipping.`);
  } else {
    const hash = await bcrypt.hash(password, 12);
    await db.execute("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'super_admin')", [name, email.toLowerCase(), hash]);
    console.log(`Created super admin ${email}`);
  }

  const [[{ c }]] = await db.query('SELECT COUNT(*) AS c FROM sites');
  if (c === 0) {
    for (const s of DEMO_SITES) {
      const origins = JSON.stringify([`https://${s.domain}`, `https://www.${s.domain}`]);
      await db.execute('INSERT INTO sites (name, domain, color, api_key, allowed_origins) VALUES (?, ?, ?, ?, ?)', [s.name, s.domain, s.color, generateApiKey(), origins]);
      console.log(`Created demo site ${s.name}`);
    }
  } else {
    console.log('Sites already exist, skipping demo sites.');
  }
  await db.end();
})().catch(async (e) => { console.error('Seed failed:', e.message); await db.end().catch(() => {}); process.exit(1); });
