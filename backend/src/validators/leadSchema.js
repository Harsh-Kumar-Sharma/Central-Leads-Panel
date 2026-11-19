'use strict';
const { z } = require('zod');

const KNOWN = ['type', 'name', 'email', 'phone', 'subject', 'company', 'message', 'extra', 'website', 'source_url'];
const MAX_EXTRA_KEYS = 20;
const MAX_EXTRA_VALUE = 2000;

// Strip ASCII control chars (except tab/newline/carriage return) from free text.
const clean = (s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();

const optText = (max) =>
  z.preprocess(
    (v) => (v === null || v === undefined ? undefined : typeof v === 'number' ? String(v) : v),
    z.string().transform(clean).pipe(z.string().max(max, `Must be at most ${max} characters`)).optional()
  ).transform((v) => (v ? v : undefined));

const extraValue = z.union([
  z.string().transform(clean).pipe(z.string().max(MAX_EXTRA_VALUE, `Each extra value must be at most ${MAX_EXTRA_VALUE} characters`)),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

// Letters/digits in any script (Hindi labels etc.), space, _ - .
const extraKey = (k) => /^[\p{L}\p{M}\p{N} _\-.]{1,64}$/u.test(k);

const leadSchema = z
  .object({
    type: z.enum(['inquiry', 'quote'], { message: "Must be 'inquiry' or 'quote'" }),
    name: z.preprocess(
      (v) => (typeof v === 'string' ? v : v),
      z.string({ message: 'Name is required' }).transform(clean).pipe(z.string().min(1, 'Name is required').max(200, 'Must be at most 200 characters'))
    ),
    email: optText(200).pipe(z.string().email('Invalid email address').optional()),
    phone: optText(30).pipe(
      z.string().regex(/^[0-9+\-() ]+$/, 'Phone may contain only digits, spaces, +, -, ( )').optional()
    ),
    subject: optText(255),
    company: optText(200),
    message: optText(5000),
    source_url: optText(500),
    website: z.any().optional(), // honeypot
    extra: z.record(z.string(), extraValue).optional(),
  })
  .superRefine((d, ctx) => {
    if (!d.email && !d.phone) {
      ctx.addIssue({ code: 'custom', path: ['email'], message: 'Email or phone is required' });
    }
    if (d.extra) {
      const keys = Object.keys(d.extra);
      if (keys.length > MAX_EXTRA_KEYS) ctx.addIssue({ code: 'custom', path: ['extra'], message: `At most ${MAX_EXTRA_KEYS} extra fields allowed` });
      for (const k of keys) if (!extraKey(k)) ctx.addIssue({ code: 'custom', path: ['extra'], message: `Invalid extra field name: ${k.slice(0, 64)}` });
    }
  });

/**
 * Moves unknown top-level fields into `extra` (never an error), then validates.
 * Returns zod's safeParse result.
 */
function parseLead(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { success: false, error: { issues: [{ path: ['_'], message: 'Body must be a JSON object' }] } };
  }
  const input = {};
  const extra = {};
  const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

  // 1) An explicit `extra` object is the site's own mapping: validated strictly (spec limits).
  if (body.extra && typeof body.extra === 'object' && !Array.isArray(body.extra)) {
    for (const [k, v] of Object.entries(body.extra)) {
      if (FORBIDDEN.has(k)) continue;
      extra[k] = v !== null && typeof v === 'object' ? JSON.stringify(v).slice(0, MAX_EXTRA_VALUE) : v;
    }
  }

  // 2) Unknown top-level fields must never cause an error (spec §3): they are moved into
  //    `extra` leniently — key names sanitised, values stringified/truncated, and only up to
  //    the 20-key limit. Nothing is lost: the full original body is kept in raw_payload.
  const unknown = Object.entries(body).filter(([k]) => !KNOWN.includes(k) && !FORBIDDEN.has(k));
  if (body.extra !== undefined && body.extra !== null && (typeof body.extra !== 'object' || Array.isArray(body.extra))) {
    unknown.unshift(['extra', body.extra]);
  }
  for (const [k, v] of Object.entries(body)) if (KNOWN.includes(k) && k !== 'extra') input[k] = v;
  for (const [rawKey, v] of unknown) {
    if (Object.keys(extra).length >= MAX_EXTRA_KEYS) break;
    let key = String(rawKey).replace(/[^\p{L}\p{M}\p{N} _\-.]/gu, '_').replace(/_+/g, '_')
      .replace(/^[\s_]+|[\s_]+$/g, '').slice(0, 64).trim() || 'field';
    while (Object.prototype.hasOwnProperty.call(extra, key) || FORBIDDEN.has(key)) key = `${key.slice(0, 60)}_${Math.floor(Math.random() * 900 + 100)}`;
    let value = v;
    if (value !== null && typeof value === 'object') value = JSON.stringify(value);
    if (typeof value === 'string') value = clean(value).slice(0, MAX_EXTRA_VALUE);
    if (typeof value === 'number' && !Number.isFinite(value)) value = String(value);
    extra[key] = value;
  }
  if (Object.keys(extra).length) input.extra = extra;
  return leadSchema.safeParse(input);
}

module.exports = { parseLead, leadSchema };
