'use strict';
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const db = require('../config/db');
const HttpError = require('../utils/httpError');

const JWT_OPTS = { algorithms: ['HS256'], issuer: 'central-leads-panel', audience: 'clp-dashboard' };

exports.signToken = (user) =>
  jwt.sign({ sub: String(user.id), tv: user.token_version }, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: JWT_OPTS.issuer,
    audience: JWT_OPTS.audience,
  });

/**
 * Verifies the Bearer token AND re-checks the user in the DB on every request,
 * so deactivation, role changes and password changes take effect immediately.
 */
exports.requireAuth = async (req, res, next) => {
  try {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token || token.length > 2048) throw new HttpError(401, 'Authentication required');

    let payload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET, JWT_OPTS);
    } catch {
      throw new HttpError(401, 'Invalid or expired session');
    }
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) throw new HttpError(401, 'Invalid session');

    const [rows] = await db.execute(
      'SELECT id, name, email, role, is_active, token_version FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    const user = rows[0];
    if (!user || !user.is_active || user.token_version !== payload.tv) {
      throw new HttpError(401, 'Session is no longer valid');
    }
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
};

exports.requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have permission for this action'));
  next();
};

/**
 * Site scoping helper. Returns null for super_admin (no restriction),
 * otherwise an array of site ids (possibly empty).
 */
async function getAllowedSiteIds(user) {
  if (user.role === 'super_admin') return null;
  const [rows] = await db.execute('SELECT site_id FROM user_sites WHERE user_id = ?', [user.id]);
  return rows.map((r) => r.site_id);
}
exports.getAllowedSiteIds = getAllowedSiteIds;

// Middleware form: attaches req.allowedSiteIds for downstream handlers.
exports.loadSiteScope = async (req, res, next) => {
  try {
    req.allowedSiteIds = await getAllowedSiteIds(req.user);
    next();
  } catch (err) {
    next(err);
  }
};
