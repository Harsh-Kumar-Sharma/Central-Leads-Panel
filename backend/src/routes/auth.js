'use strict';
const express = require('express');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const HttpError = require('../utils/httpError');
const { signToken, requireAuth, getAllowedSiteIds } = require('../middleware/auth');
const { loginLimiter, loginIpLimiter, changePasswordLimiter } = require('../middleware/rateLimit');
const hub = require('../services/sseHub');

const router = express.Router();
// Used to keep login timing constant when the email does not exist (prevents user enumeration).
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', 12);

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

router.post('/login', loginIpLimiter, loginLimiter, asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(401, 'Invalid email or password');
  const { email, password } = parsed.data;

  const [rows] = await db.execute(
    'SELECT id, name, email, role, is_active, password_hash, token_version FROM users WHERE email = ? LIMIT 1',
    [email]
  );
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok || !user.is_active) throw new HttpError(401, 'Invalid email or password');

  await db.execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
  res.json({
    success: true,
    token: signToken(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const siteIds = await getAllowedSiteIds(req.user);
  res.json({ success: true, user: { ...req.user, site_ids: siteIds } });
}));

const changeSchema = z.object({
  current_password: z.string().min(1).max(200),
  new_password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

router.post('/change-password', requireAuth, changePasswordLimiter, asyncHandler(async (req, res) => {
  const { current_password, new_password } = changeSchema.parse(req.body);
  const [[row]] = await db.execute('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!row || !(await bcrypt.compare(current_password, row.password_hash))) {
    throw new HttpError(400, 'Current password is incorrect', { current_password: 'Current password is incorrect' });
  }
  const hash = await bcrypt.hash(new_password, 12);
  // Bumping token_version logs out every other session using the old password.
  await db.execute('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [hash, req.user.id]);
  const [[u]] = await db.execute('SELECT id, token_version FROM users WHERE id = ?', [req.user.id]);
  hub.recheckUsers([req.user.id]); // close live streams that still use an old token, right away
  res.json({ success: true, token: signToken(u) });
}));

/**
 * Sign out: revokes THIS token on the server (other devices stay signed in), so a copied
 * token is useless after sign-out instead of staying valid until it expires.
 */
router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  const { jti, exp } = req.auth;
  if (jti && exp) {
    await db.execute('INSERT IGNORE INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))', [jti, req.user.id, exp]);
    hub.closeToken(jti);
  }
  res.json({ success: true });
}));

module.exports = router;
