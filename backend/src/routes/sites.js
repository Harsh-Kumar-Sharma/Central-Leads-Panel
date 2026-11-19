'use strict';
const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, loadSiteScope } = require('../middleware/auth');
const { scopeClause } = require('../services/leadService');

const router = express.Router();
router.use(requireAuth, loadSiteScope);

// Sites visible to this user. api_key is never exposed here.
router.get('/', asyncHandler(async (req, res) => {
  const scope = scopeClause(req.allowedSiteIds, 'id');
  if (!scope) return res.json([]);
  const [rows] = await db.execute(
    `SELECT id, name, color, domain, is_active FROM sites WHERE ${scope.sql} ORDER BY name`,
    scope.params
  );
  res.json(rows);
}));

module.exports = router;
