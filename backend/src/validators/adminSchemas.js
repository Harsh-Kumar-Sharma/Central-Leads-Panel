'use strict';
const { z } = require('zod');
const { normalizeOrigin } = require('../middleware/siteKey');

const origins = z
  .array(z.string().trim().max(255))
  .max(20, 'At most 20 origins')
  .default([])
  .superRefine((arr, ctx) => {
    arr.forEach((o, i) => {
      if (!o) return;
      let ok = false;
      try {
        const u = new URL(o);
        ok = !!normalizeOrigin(o) && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password;
      } catch { ok = false; }
      if (!ok) {
        ctx.addIssue({ code: 'custom', path: [i], message: `"${o.slice(0, 60)}" must be an origin like https://example.com (no path)` });
      }
    });
  })
  .transform((arr) => [...new Set(arr.filter(Boolean).map(normalizeOrigin))]);

const siteBody = z.object({
  name: z.string().trim().min(1, 'Name is required').max(150),
  domain: z.string().trim().toLowerCase().min(1, 'Domain is required').max(255)
    .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'Enter a domain like example.com'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be like #3B82F6').transform((c) => c.toUpperCase()),
  allowed_origins: origins,
  is_active: z.boolean().default(true),
});

const ROLES = ['super_admin', 'manager', 'viewer'];
const password = z.string().min(8, 'Password must be at least 8 characters').max(200);

const userCreate = z.object({
  name: z.string().trim().min(1, 'Name is required').max(150),
  email: z.string().trim().toLowerCase().email('Invalid email').max(200),
  password,
  role: z.enum(ROLES),
  is_active: z.boolean().default(true),
  site_ids: z.array(z.number().int().positive()).max(500).default([]),
});

const userUpdate = z.object({
  name: z.string().trim().min(1, 'Name is required').max(150),
  email: z.string().trim().toLowerCase().email('Invalid email').max(200).optional(),
  password: z.union([password, z.literal('')]).optional(),
  role: z.enum(ROLES),
  is_active: z.boolean(),
  site_ids: z.array(z.number().int().positive()).max(500).default([]),
});

module.exports = { siteBody, userCreate, userUpdate };
