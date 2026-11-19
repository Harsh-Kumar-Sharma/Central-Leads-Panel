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

const extraKey = (k) => /^[A-Za-z0-9 _\-.]{1,64}$/.test(k);

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
  let extra = {};
  if (body.extra && typeof body.extra === 'object' && !Array.isArray(body.extra)) extra = { ...body.extra };
  else if (body.extra !== undefined && body.extra !== null) extra.extra = body.extra;

  for (const [k, v] of Object.entries(body)) {
    if (k === 'extra') continue;
    if (KNOWN.includes(k)) input[k] = v;
    else if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') extra[k] = v;
  }
  // Flatten non-scalar extra values into JSON strings so nothing is lost.
  for (const [k, v] of Object.entries(extra)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') { delete extra[k]; continue; }
    if (v !== null && typeof v === 'object') extra[k] = JSON.stringify(v).slice(0, MAX_EXTRA_VALUE);
  }
  if (Object.keys(extra).length) input.extra = extra;
  return leadSchema.safeParse(input);
}

module.exports = { parseLead, leadSchema };
