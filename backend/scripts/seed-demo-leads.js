'use strict';
// Development only: fills the DB with sample leads spread over the last 30 days.
const env = require('../src/config/env');
const db = require('../src/config/db');

if (env.NODE_ENV === 'production') {
  console.error('Refusing to insert demo leads in production.');
  process.exit(1);
}

const NAMES = ['Rahul Sharma', 'Priya Verma', 'Amit Patel', 'Sneha Iyer', 'Vikram Singh', 'Anjali Gupta', 'Rohan Mehta', 'Kavya Nair', 'Arjun Reddy', 'Neha Joshi'];
const SUBJECTS = ['Operating lease enquiry', 'Need a quotation', 'Site visit request', 'Pricing details', 'Partnership', null];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

(async () => {
  const [sites] = await db.query('SELECT id FROM sites');
  if (!sites.length) throw new Error('Run npm run seed first');
  const count = Number(process.argv[2]) || 120;
  for (let i = 0; i < count; i++) {
    const name = pick(NAMES);
    const daysAgo = Math.floor(Math.pow(Math.random(), 1.6) * 30);
    const created = new Date(Date.now() - daysAgo * 86400000 - Math.floor(Math.random() * 36000000));
    const type = Math.random() < 0.62 ? 'inquiry' : 'quote';
    const body = { type, name, email: name.split(' ')[0].toLowerCase() + i + '@example.com', phone: '98' + String(10000000 + i * 7919).slice(0, 8), message: 'Hello, I would like more information about your services.' };
    const status = Math.random() < 0.55 ? 'new' : pick(['contacted', 'followup', 'closed']);
    await db.execute(
      `INSERT INTO leads (site_id, type, name, email, phone, subject, message, raw_payload, status, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [pick(sites).id, type, name, body.email, body.phone, pick(SUBJECTS), body.message, JSON.stringify(body), status, status === 'new' && Math.random() < 0.7 ? 0 : 1, created]
    );
  }
  console.log(`Inserted ${count} demo leads.`);
  await db.end();
})().catch(async (e) => { console.error(e.message); await db.end().catch(() => {}); process.exit(1); });
