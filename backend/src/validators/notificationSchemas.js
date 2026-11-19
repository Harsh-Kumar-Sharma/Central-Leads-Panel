'use strict';
const { z } = require('zod');

const noNewlines = (max, label) =>
  z.string().trim().max(max).refine((s) => !/[\r\n]/.test(s), `${label} cannot contain line breaks`);

// Hostname or IPv4. Admin-supplied, used only by super admins.
const host = z.string().trim().toLowerCase().min(1, 'Host is required').max(255)
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$|^\d{1,3}(\.\d{1,3}){3}$/, 'Enter a valid SMTP host (e.g. smtp.gmail.com)');

const email = z.string().trim().toLowerCase().email('Invalid email address').max(200);

/**
 * SMTP config. When enabled, every field is required; when disabled the admin may
 * save a partial draft. `password` empty/omitted = keep the stored one.
 */
const smtpFields = {
  host: z.union([host, z.literal('')]).default(''),
  port: z.coerce.number().int().min(1, 'Invalid port').max(65535, 'Invalid port').default(587),
  secure: z.boolean().default(false),
  username: noNewlines(255, 'Username').default(''),
  password: z.string().max(500).optional(),
  from_name: noNewlines(150, 'From name').default(''),
  from_email: z.union([email, z.literal('')]).default(''),
};

const requireComplete = (d, ctx) => {
  if (!d.host) ctx.addIssue({ code: 'custom', path: ['host'], message: 'Host is required' });
  if (!d.username) ctx.addIssue({ code: 'custom', path: ['username'], message: 'Username is required' });
  if (!d.from_name) ctx.addIssue({ code: 'custom', path: ['from_name'], message: 'From name is required' });
  if (!d.from_email) ctx.addIssue({ code: 'custom', path: ['from_email'], message: 'From email is required' });
};

const smtpGlobal = z.object({ enabled: z.boolean().default(false), ...smtpFields })
  .superRefine((d, ctx) => { if (d.enabled) requireComplete(d, ctx); });

const smtpSite = z.object({ is_enabled: z.boolean().default(false), ...smtpFields })
  .superRefine((d, ctx) => { if (d.is_enabled) requireComplete(d, ctx); });

/** Test mail: recipient plus optional unsaved config (blank password = use saved). */
const smtpTest = z.object({
  to: email,
  config: z.object(smtpFields).superRefine(requireComplete).optional(),
});

const mode = z.enum(['to', 'cc', 'bcc']);
const uniqueEmails = (list, ctx) => {
  const seen = new Set();
  list.forEach((r, i) => {
    if (seen.has(r.email)) ctx.addIssue({ code: 'custom', path: [i, 'email'], message: `${r.email} is listed twice` });
    seen.add(r.email);
  });
};
const globalRecipients = z.array(z.object({ email, mode: mode.default('to') })).max(50, 'At most 50 recipients').superRefine(uniqueEmails);
const siteRecipients = z.array(z.object({ email, mode: mode.default('to'), is_active: z.boolean().default(true) }))
  .max(50, 'At most 50 recipients').superRefine(uniqueEmails);

const emailLogQuery = z.object({
  site_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['pending', 'sent', 'retrying', 'failed']).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
});

module.exports = { smtpGlobal, smtpSite, smtpTest, globalRecipients, siteRecipients, emailLogQuery };
