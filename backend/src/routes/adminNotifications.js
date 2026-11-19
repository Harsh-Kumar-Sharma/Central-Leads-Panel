'use strict';
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const asyncHandler = require('../utils/asyncHandler');
const HttpError = require('../utils/httpError');
const { requireAuth, requireRole } = require('../middleware/auth');
const { idParam } = require('../validators/leadQuery');
const v = require('../validators/notificationSchemas');
const settings = require('../services/settingsService');
const email = require('../services/emailService');

// Super admin only: SMTP settings, recipients, email log.
const router = express.Router();
router.use(requireAuth, requireRole('super_admin'));

// Test mails hit external SMTP servers: keep them rare.
const testLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `smtp-test|${req.user.id}`,
  handler: (req, res) => res.status(429).json({ success: false, message: 'Too many test emails. Wait a minute.' }),
});

async function requireSite(req) {
  const { id } = idParam.parse(req.params);
  const site = await settings.siteExists(id);
  if (!site) throw new HttpError(404, 'Site not found');
  return site;
}

// ---------------- Global SMTP ----------------
router.get('/settings/smtp-global', asyncHandler(async (req, res) => {
  res.json(await settings.getGlobalSmtp());
}));

router.put('/settings/smtp-global', asyncHandler(async (req, res) => {
  res.json(await settings.saveGlobalSmtp(v.smtpGlobal.parse(req.body)));
}));

router.post('/settings/smtp-global/test', testLimiter, asyncHandler(async (req, res) => {
  const body = v.smtpTest.parse(req.body);
  res.json(await email.sendTest(body, await settings.getGlobalSmtpRaw(), 'global'));
}));

// ---------------- Global recipients ----------------
router.get('/settings/global-recipients', asyncHandler(async (req, res) => {
  res.json(await settings.getGlobalRecipients());
}));

router.put('/settings/global-recipients', asyncHandler(async (req, res) => {
  res.json(await settings.saveGlobalRecipients(v.globalRecipients.parse(req.body)));
}));

// ---------------- Per-company SMTP ----------------
router.get('/sites/:id/smtp', asyncHandler(async (req, res) => {
  const site = await requireSite(req);
  res.json(await settings.getSiteSmtp(site.id));
}));

router.put('/sites/:id/smtp', asyncHandler(async (req, res) => {
  const site = await requireSite(req);
  res.json(await settings.saveSiteSmtp(site.id, v.smtpSite.parse(req.body)));
}));

router.post('/sites/:id/smtp/test', testLimiter, asyncHandler(async (req, res) => {
  const site = await requireSite(req);
  const body = v.smtpTest.parse(req.body);
  res.json(await email.sendTest(body, await settings.getSiteSmtpRaw(site.id), `"${site.name}"`));
}));

// ---------------- Per-company recipients ----------------
router.get('/sites/:id/recipients', asyncHandler(async (req, res) => {
  const site = await requireSite(req);
  res.json(await settings.getSiteRecipients(site.id));
}));

router.put('/sites/:id/recipients', asyncHandler(async (req, res) => {
  const site = await requireSite(req);
  res.json(await settings.saveSiteRecipients(site.id, v.siteRecipients.parse(req.body)));
}));

// Preview: which SMTP and which final recipients a lead from this company would use.
router.get('/sites/:id/notification-preview', asyncHandler(async (req, res) => {
  const site = await requireSite(req);
  res.json({ smtp_source: await email.resolveSmtpSource(site.id), recipients: await email.resolveRecipients(site.id) });
}));

// ---------------- Email log ----------------
router.get('/email-logs', asyncHandler(async (req, res) => {
  res.json(await email.listLogs(v.emailLogQuery.parse(req.query)));
}));

router.post('/email-logs/:id/retry', asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await email.retry(id));
}));

module.exports = router;
