'use strict';
const env = require('../config/env');

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const oneLine = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim();

const humanizeKey = (k) => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ')
  .trim().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const istFormat = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const safeHttpUrl = (u) => { try { const x = new URL(u); return ['http:', 'https:'].includes(x.protocol) ? x.href : null; } catch { return null; } };
const typeLabel = (t) => (t === 'quote' ? 'Quote' : 'Inquiry');

/** Subject: [Company] New Inquiry: Name  (single line, max 300 chars) */
exports.buildSubject = (lead) =>
  oneLine(`[${lead.site_name}] New ${typeLabel(lead.type)}: ${lead.name}`).slice(0, 300);

exports.leadLink = (leadId) => `${env.APP_BASE_URL}/leads?open=${encodeURIComponent(leadId)}`;

/**
 * Builds the HTML + plain-text email for a lead. Every visitor-supplied value is
 * escaped; raw_payload, IP and user agent are never included.
 */
exports.buildLeadEmail = (lead) => {
  const extra = lead.extra ? (typeof lead.extra === 'string' ? JSON.parse(lead.extra) : lead.extra) : {};
  const received = lead.created_at ? `${istFormat.format(new Date(lead.created_at))} IST` : '';
  const source = safeHttpUrl(lead.source_url);
  const link = exports.leadLink(lead.id);
  const color = /^#[0-9a-f]{6}$/i.test(lead.site_color || '') ? lead.site_color : '#6366F1';

  const fields = [
    ['Company', lead.site_name],
    ['Type', typeLabel(lead.type)],
    ['Name', lead.name],
    ['Phone', lead.phone],
    ['Email', lead.email],
    ['Subject', lead.subject],
    ["Visitor's company", lead.company],
    ...Object.entries(extra).map(([k, v]) => [humanizeKey(k), v === null || v === undefined ? '' : String(v)]),
    ['Received', received],
    ['Source URL', lead.source_url],
  ].filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');

  const rows = fields.map(([k, v]) => `
      <tr>
        <td style="padding:8px 12px;color:#64708a;font-size:13px;width:160px;vertical-align:top;border-bottom:1px solid #eef1f6">${esc(k)}</td>
        <td style="padding:8px 12px;color:#121826;font-size:14px;vertical-align:top;border-bottom:1px solid #eef1f6;word-break:break-word">${
          k === 'Source URL' && source ? `<a href="${esc(source)}" style="color:${color}">${esc(v)}</a>` : esc(v)
        }</td>
      </tr>`).join('');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(exports.buildSubject(lead))}</title></head>
<body style="margin:0;padding:24px;background:#f4f6fb;font-family:Segoe UI,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e7f0">
    <tr><td style="background:${color};height:6px"></td></tr>
    <tr><td style="padding:24px 24px 8px">
      <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:${color}1f;color:${color};font-size:12px;font-weight:700">${esc(lead.site_name)}</div>
      <h1 style="margin:12px 0 4px;font-size:20px;color:#121826">New ${esc(typeLabel(lead.type).toLowerCase())} from ${esc(lead.name)}</h1>
      <p style="margin:0;color:#64708a;font-size:13px">${esc(received)}</p>
    </td></tr>
    <tr><td style="padding:8px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
    ${lead.message ? `<tr><td style="padding:8px 24px 0"><div style="color:#64708a;font-size:13px;margin-bottom:6px">Message</div>
      <div style="background:#f6f7fb;border-radius:10px;padding:14px;color:#121826;font-size:14px;line-height:1.55;white-space:pre-wrap;word-break:break-word">${esc(lead.message)}</div></td></tr>` : ''}
    <tr><td style="padding:24px">
      <a href="${esc(link)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:10px">View lead</a>
      ${lead.email ? '<p style="margin:14px 0 0;color:#64708a;font-size:12px">Reply to this email to answer the visitor directly.</p>' : ''}
    </td></tr>
  </table>
  <p style="text-align:center;color:#94a3b8;font-size:11px;margin-top:16px">Sent by Central Leads Panel</p>
</body></html>`;

  const text = [
    `New ${typeLabel(lead.type)} - ${lead.site_name}`,
    '',
    ...fields.map(([k, v]) => `${k}: ${oneLine(v)}`),
    '',
    lead.message ? `Message:\n${lead.message}\n` : '',
    `View lead: ${link}`,
  ].join('\n');

  return { subject: exports.buildSubject(lead), html, text };
};

exports._internals = { esc, humanizeKey };
