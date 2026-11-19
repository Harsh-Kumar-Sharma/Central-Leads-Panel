'use strict';
const { z } = require('zod');

const STATUSES = ['new', 'contacted', 'followup', 'closed', 'spam'];
const TYPES = ['inquiry', 'quote'];
const SORTS = ['created_at', 'name', 'status', 'site'];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(s + 'T00:00:00Z')), 'Invalid date');

const csvList = (item, maxItems) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v.join(',') : v),
    z.string().max(1000).optional().transform((s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []))
  ).pipe(z.array(item).max(maxItems));

const filterSchema = z.object({
  site_ids: csvList(z.coerce.number().int().positive(), 200),
  type: z.enum(TYPES).optional().or(z.literal('').transform(() => undefined)),
  status: csvList(z.enum(STATUSES), STATUSES.length),
  from: isoDate.optional().or(z.literal('').transform(() => undefined)),
  to: isoDate.optional().or(z.literal('').transform(() => undefined)),
  q: z.string().trim().max(100).optional(),
});

const listSchema = filterSchema.extend({
  sort: z.enum(SORTS).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
});

const exportSchema = filterSchema.extend({
  sort: z.enum(SORTS).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
  format: z.enum(['csv', 'xlsx']).default('csv'),
});

const idParam = z.object({ id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
const statusBody = z.object({ status: z.enum(STATUSES) });
const noteBody = z.object({ note: z.string().trim().min(1, 'Note cannot be empty').max(5000, 'Note is too long') });

module.exports = { listSchema, exportSchema, idParam, statusBody, noteBody, STATUSES, TYPES };
