'use strict';
const db = require('../config/db');
const { isWellFormedKey } = require('../utils/apiKey');

function normalizeOrigin(o) {
  try {
    const u = new URL(o);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}
exports.normalizeOrigin = normalizeOrigin;

function parseOrigins(value) {
  if (!value) return [];
  const arr = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(arr) ? arr.map(normalizeOrigin).filter(Boolean) : [];
}

function setCors(res, origin) {
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-Site-Key');
  res.set('Access-Control-Max-Age', '600');
}

async function findSite(key) {
  if (!isWellFormedKey(key)) return null;
  const [rows] = await db.execute(
    'SELECT id, name, is_active, allowed_origins FROM sites WHERE api_key = ? LIMIT 1',
    [key]
  );
  return rows[0] || null;
}

/**
 * Preflight handler. Browsers do not send X-Site-Key on OPTIONS, so we can only
 * allow an origin that is listed by at least one active site.
 */
exports.ingestPreflight = async (req, res, next) => {
  try {
    const origin = normalizeOrigin(req.get('origin') || '');
    if (!origin) return res.sendStatus(204);
    const [rows] = await db.execute(
      'SELECT 1 FROM sites WHERE is_active = 1 AND JSON_CONTAINS(allowed_origins, JSON_QUOTE(?)) LIMIT 1',
      [origin]
    );
    if (rows.length) setCors(res, origin);
    return res.sendStatus(204);
  } catch (err) {
    next(err);
  }
};

/** Validates X-Site-Key, site active status, and Origin; sets strict CORS. */
exports.requireSiteKey = async (req, res, next) => {
  try {
    const key = req.get('x-site-key');
    const site = key ? await findSite(key) : null;
    const rawOrigin = req.get('origin');
    const origin = rawOrigin ? normalizeOrigin(rawOrigin) : null;
    const allowed = site ? parseOrigins(site.allowed_origins) : [];

    // Only reflect an origin that the site explicitly allows; never "*".
    if (origin && allowed.includes(origin)) setCors(res, origin);

    if (!site) return res.status(401).json({ success: false, message: 'Invalid or missing site key' });
    if (!site.is_active) return res.status(403).json({ success: false, message: 'Site is inactive' });
    if (rawOrigin && allowed.length && (!origin || !allowed.includes(origin))) {
      return res.status(403).json({ success: false, message: 'Origin not allowed' });
    }
    req.site = { id: site.id, name: site.name };
    next();
  } catch (err) {
    next(err);
  }
};
