'use strict';
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const json429 = (message) => (req, res) =>
  res.status(429).json({ success: false, message });

// Whole-server ceiling per IP.
exports.globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: json429('Too many requests, slow down.'),
});

// Ingest: 10 / minute per IP per site key.
exports.ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.get('x-site-key') || '').slice(0, 80)}`,
  handler: json429('Too many submissions. Please try again in a minute.'),
});

// Ingest, BEFORE the key lookup: per-IP ceiling so floods of junk/invalid keys are cut off cheaply.
// Generous enough for one web server that posts leads for many sites.
exports.ingestIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: json429('Too many requests, slow down.'),
});

// Ingest, AFTER a valid key: ceiling per site across all IPs (global limit per spec).
// Keyed per site so abuse of one site's key can never block the other websites.
exports.ingestSiteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `ingest-site|${req.site.id}`,
  handler: json429('Service busy, please try again shortly.'),
});

// Login: 5 attempts / 15 min per IP+email (only failed attempts count).
exports.loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 200) : '';
    return `${ipKeyGenerator(req.ip)}|${email}`;
  },
  handler: json429('Too many login attempts. Try again in 15 minutes.'),
});

// Change password: 5 wrong "current password" guesses / 15 min per user (a stolen token
// must not be usable to brute-force the real password).
exports.changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `chpw|${req.user.id}`,
  handler: json429('Too many attempts. Try again in 15 minutes.'),
});

// Login: per-IP ceiling regardless of email (stops credential stuffing across many emails).
exports.loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: json429('Too many login attempts from this network. Try again later.'),
});
