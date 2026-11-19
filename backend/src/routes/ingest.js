'use strict';
const express = require('express');
const { requireSiteKey, ingestPreflight } = require('../middleware/siteKey');
const { ingestLimiter, ingestIpLimiter, ingestSiteLimiter } = require('../middleware/rateLimit');
const { parseLead } = require('../validators/leadSchema');
const { zodToErrors } = require('../middleware/errorHandler');
const leadService = require('../services/leadService');

const router = express.Router();

router.options('/leads', ingestPreflight);

// Order matters: a cheap per-IP limit protects the key lookup; only requests with a VALID key
// count toward the per-key and per-site limits, so junk traffic cannot block real websites.
router.post('/leads', ingestIpLimiter, requireSiteKey, ingestLimiter, ingestSiteLimiter, async (req, res) => {
  try {
    if (!req.is('application/json')) {
      return res.status(415).json({ success: false, message: 'Content-Type must be application/json' });
    }
    const body = req.body;
    const parsed = parseLead(body);
    if (!parsed.success) return res.status(400).json({ success: false, errors: zodToErrors(parsed.error) });

    const data = parsed.data;
    const honeypot = typeof data.website === 'string' ? data.website.trim() : data.website;
    const isSpam = honeypot !== undefined && honeypot !== null && honeypot !== '' && honeypot !== false;
    delete data.website;

    const referer = req.get('referer');
    const sourceUrl = (data.source_url || referer || '').slice(0, 500) || null;
    delete data.source_url;

    const id = await leadService.createLead({
      siteId: req.site.id,
      data,
      rawBody: body,
      isSpam,
      meta: { source_url: sourceUrl, ip: (req.ip || '').slice(0, 45), user_agent: (req.get('user-agent') || '').slice(0, 300) },
    });
    return res.status(201).json({ success: true, id });
  } catch (err) {
    console.error('[ingest] failed:', err);
    return res.status(500).json({ success: false, message: 'Could not save your submission. Please try again.' });
  }
});

module.exports = router;
