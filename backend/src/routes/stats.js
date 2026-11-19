'use strict';
const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, loadSiteScope } = require('../middleware/auth');
const stats = require('../services/statsService');

const router = express.Router();
router.use(requireAuth, loadSiteScope);

router.get('/overview', asyncHandler(async (req, res) => {
  res.json(await stats.overview(req.allowedSiteIds));
}));

router.get('/daily', asyncHandler(async (req, res) => {
  const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
  res.json(await stats.daily(req.allowedSiteIds, days));
}));

router.get('/by-site', asyncHandler(async (req, res) => {
  const { range } = z.object({ range: z.enum(stats.RANGES).default('month') }).parse(req.query);
  res.json(await stats.bySite(req.allowedSiteIds, range));
}));

module.exports = router;
