'use strict';
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const HttpError = require('../utils/httpError');
const { requireAuth, requireRole, loadSiteScope } = require('../middleware/auth');
const leads = require('../services/leadService');
const exporter = require('../services/exportService');
const { listSchema, exportSchema, idParam, statusBody, noteBody } = require('../validators/leadQuery');

const router = express.Router();
router.use(requireAuth, loadSiteScope);

const parseJson = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
};

router.get('/', asyncHandler(async (req, res) => {
  const f = listSchema.parse(req.query);
  res.json(await leads.list(f, req.allowedSiteIds));
}));

// Must be registered before "/:id".
router.get('/export', asyncHandler(async (req, res) => {
  const f = exportSchema.parse(req.query);
  const rows = await leads.listForExport(f, req.allowedSiteIds);
  const stamp = new Date().toISOString().slice(0, 10);
  if (f.format === 'xlsx') {
    const buf = await exporter.toXlsx(rows);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="leads-${stamp}.xlsx"`);
    return res.send(Buffer.from(buf));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="leads-${stamp}.csv"`);
  return res.send(exporter.toCsv(rows));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const lead = await leads.getDetail(id, req.allowedSiteIds);
  if (!lead) throw new HttpError(404, 'Lead not found');
  lead.extra = parseJson(lead.extra);
  lead.raw_payload = parseJson(lead.raw_payload);
  res.json(lead);
}));

router.patch('/:id', requireRole('super_admin', 'manager'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { status } = statusBody.parse(req.body);
  const ok = await leads.updateStatus(id, status, req.allowedSiteIds);
  if (!ok) throw new HttpError(404, 'Lead not found');
  res.json({ success: true, status });
}));

router.post('/:id/notes', requireRole('super_admin', 'manager'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { note } = noteBody.parse(req.body);
  const created = await leads.addNote(id, note, req.user, req.allowedSiteIds);
  if (!created) throw new HttpError(404, 'Lead not found');
  res.status(201).json(created);
}));

module.exports = router;
