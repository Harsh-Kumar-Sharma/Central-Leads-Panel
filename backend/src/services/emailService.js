'use strict';
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('../config/db');
const HttpError = require('../utils/httpError');
const { decrypt } = require('../utils/crypto');
const settings = require('./settingsService');
const { buildLeadEmail, buildSubject } = require('./emailTemplate');

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_SEC = [60, 300]; // after attempt 1 -> 1 min, after attempt 2 -> 5 min
const SWEEP_EVERY_MS = 60 * 1000;
const MODE_RANK = { to: 0, cc: 1, bcc: 2 };

// ---------------------------------------------------------------- transporters
const transporters = new Map();
settings.onChange(() => {
  for (const t of transporters.values()) t.close();
  transporters.clear();
});

const isLocalHost = (h) => ['localhost', '127.0.0.1', '::1'].includes(String(h).toLowerCase());

function transportOptions(cfg) {
  return {
    host: cfg.host,
    port: cfg.port,
    secure: !!cfg.secure, // true = implicit TLS (465); false = STARTTLS (587)
    // Never send credentials in clear text over the internet: require STARTTLS unless the host is local.
    requireTLS: !cfg.secure && !isLocalHost(cfg.host),
    auth: cfg.username ? { user: cfg.username, pass: cfg.pass } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    tls: { minVersion: 'TLSv1.2' },
  };
}

function getTransporter(cfg) {
  const key = crypto.createHash('sha256')
    .update(JSON.stringify([cfg.host, cfg.port, !!cfg.secure, cfg.username, cfg.pass])).digest('hex');
  let t = transporters.get(key);
  if (!t) {
    t = nodemailer.createTransport(transportOptions(cfg));
    transporters.set(key, t);
  }
  return t;
}

/** Turns an SMTP error into a short message that never contains the password. */
function smtpErrorMessage(err, pass) {
  let msg = `${err.code ? `${err.code}: ` : ''}${err.response || err.message || 'Unknown SMTP error'}`;
  if (pass) msg = msg.split(pass).join('***');
  return msg.slice(0, 1000);
}

// ---------------------------------------------------------------- resolution
/** Company SMTP if enabled, else global SMTP if enabled, else null. Password decrypted here only. */
async function resolveSmtp(siteId) {
  const site = siteId ? await settings.getSiteSmtpRaw(siteId) : null;
  if (site && site.is_enabled && site.host && site.password_enc) {
    return { source: 'site', cfg: { ...site, pass: decrypt(site.password_enc) } };
  }
  const g = await settings.getGlobalSmtpRaw();
  if (g && g.enabled && g.host && g.password_enc) {
    return { source: 'global', cfg: { ...g, pass: decrypt(g.password_enc) } };
  }
  return null;
}
exports.resolveSmtpSource = async (siteId) => {
  const site = siteId ? await settings.getSiteSmtpRaw(siteId) : null;
  if (site && site.is_enabled && site.host && site.password_enc) return 'site';
  const g = await settings.getGlobalSmtpRaw();
  return g && g.enabled && g.host && g.password_enc ? 'global' : null;
};

/**
 * Company recipients (active) + global recipients, de-duplicated (to > cc > bcc).
 * If there is no "to", the first cc/bcc is promoted.
 */
async function resolveRecipients(siteId) {
  const site = siteId ? (await settings.getSiteRecipients(siteId)).filter((r) => r.is_active) : [];
  const global = await settings.getGlobalRecipients();
  const best = new Map();
  for (const r of [...site, ...global]) {
    const email = String(r.email).trim().toLowerCase();
    const mode = MODE_RANK[r.mode] !== undefined ? r.mode : 'to';
    if (!email) continue;
    if (!best.has(email) || MODE_RANK[mode] < MODE_RANK[best.get(email)]) best.set(email, mode);
  }
  const out = { to: [], cc: [], bcc: [] };
  for (const [email, mode] of best) out[mode].push(email);
  if (!out.to.length) {
    if (out.cc.length) out.to.push(out.cc.shift());
    else if (out.bcc.length) out.to.push(out.bcc.shift());
  }
  return out;
}
exports.resolveRecipients = resolveRecipients;

// ---------------------------------------------------------------- lead emails
async function loadLead(leadId) {
  const [[lead]] = await db.execute(
    `SELECT l.id, l.site_id, s.name AS site_name, s.color AS site_color, l.type, l.name, l.email, l.phone,
            l.subject, l.company, l.message, l.extra, l.source_url, l.status, l.created_at
     FROM leads l JOIN sites s ON s.id = l.site_id WHERE l.id = ?`,
    [leadId]
  );
  return lead || null;
}

async function insertLog({ leadId, siteId, source, rcpt, subject, status, error }) {
  const [r] = await db.execute(
    `INSERT INTO email_logs (lead_id, site_id, smtp_source, to_addresses, cc_addresses, bcc_addresses, subject, status, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [leadId, siteId, source, JSON.stringify(rcpt.to), JSON.stringify(rcpt.cc), JSON.stringify(rcpt.bcc), subject, status, error || null]
  );
  return r.insertId;
}

/**
 * Creates the email_logs row for a new lead and sends it.
 * Never throws to the caller (ingest must not fail because of email).
 */
exports.queueLeadEmail = async (leadId) => {
  const lead = await loadLead(leadId);
  if (!lead || lead.status === 'spam') return null;
  const subject = buildSubject(lead);
  const rcpt = await resolveRecipients(lead.site_id);
  const source = await exports.resolveSmtpSource(lead.site_id);
  const base = { leadId: lead.id, siteId: lead.site_id, source: source || 'global', rcpt, subject };

  if (!source) return insertLog({ ...base, status: 'failed', error: 'No SMTP configured' });
  if (!rcpt.to.length) return insertLog({ ...base, status: 'failed', error: 'No recipients configured' });

  const id = await insertLog({ ...base, status: 'pending' });
  processLog(id).catch((e) => console.error('[email] process failed:', e.message));
  return id;
};

const inFlight = new Set();
const parseList = (v) => (v ? (typeof v === 'string' ? JSON.parse(v) : v) : []);

/** Sends one email_logs row (one attempt) and schedules the next retry if needed. */
async function processLog(id) {
  if (inFlight.has(id)) return;
  inFlight.add(id);
  let pass;
  try {
    // Atomic claim: only a row that is actually due can be taken, and taking it pushes
    // next_attempt_at forward (a 2-minute lease). So the retry timer and the minute sweep can
    // never both send the same attempt, and a crash mid-send is retried after the lease.
    const [claim] = await db.execute(
      `UPDATE email_logs SET next_attempt_at = DATE_ADD(NOW(), INTERVAL 120 SECOND)
       WHERE id = ? AND status IN ('pending','retrying') AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())`,
      [id]
    );
    if (!claim.affectedRows) return;
    const [[row]] = await db.execute('SELECT * FROM email_logs WHERE id = ?', [id]);
    if (!row) return;

    const lead = row.lead_id ? await loadLead(row.lead_id) : null;
    if (!lead) {
      await db.execute("UPDATE email_logs SET status = 'failed', error = 'Lead no longer exists', next_attempt_at = NULL WHERE id = ?", [id]);
      return;
    }
    let smtp;
    try {
      smtp = await resolveSmtp(row.site_id);
    } catch {
      // Stored password cannot be decrypted (e.g. SECRET_ENCRYPTION_KEY changed): retrying will not help.
      await db.execute("UPDATE email_logs SET status = 'failed', error = 'Cannot decrypt the SMTP password. Re-save the SMTP settings.', next_attempt_at = NULL WHERE id = ?", [id]);
      return;
    }
    if (!smtp) {
      await db.execute("UPDATE email_logs SET status = 'failed', error = 'No SMTP configured', next_attempt_at = NULL WHERE id = ?", [id]);
      return;
    }
    pass = smtp.cfg.pass;
    const { subject, html, text } = buildLeadEmail(lead);
    const attempts = row.attempts + 1;
    try {
      await getTransporter(smtp.cfg).sendMail({
        from: { name: smtp.cfg.from_name, address: smtp.cfg.from_email },
        to: parseList(row.to_addresses),
        cc: parseList(row.cc_addresses),
        bcc: parseList(row.bcc_addresses),
        replyTo: lead.email || undefined,
        subject,
        text,
        html,
        headers: { 'X-Lead-Id': String(lead.id) },
      });
      await db.execute(
        "UPDATE email_logs SET status = 'sent', attempts = ?, smtp_source = ?, sent_at = NOW(), error = NULL, next_attempt_at = NULL WHERE id = ?",
        [attempts, smtp.source, id]
      );
    } catch (err) {
      const message = smtpErrorMessage(err, pass);
      if (attempts >= MAX_ATTEMPTS) {
        await db.execute(
          "UPDATE email_logs SET status = 'failed', attempts = ?, smtp_source = ?, error = ?, next_attempt_at = NULL WHERE id = ?",
          [attempts, smtp.source, message, id]
        );
        console.warn(`[email] #${id} failed after ${attempts} attempts: ${message}`);
      } else {
        const delay = RETRY_DELAYS_SEC[attempts - 1];
        await db.execute(
          "UPDATE email_logs SET status = 'retrying', attempts = ?, smtp_source = ?, error = ?, next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id = ?",
          [attempts, smtp.source, message, delay, id]
        );
        // Timer for the normal case; the minute sweep covers restarts.
        setTimeout(() => processLog(id).catch(() => {}), delay * 1000 + 500).unref();
        console.warn(`[email] #${id} attempt ${attempts} failed, retrying in ${delay}s: ${message}`);
      }
    }
  } finally {
    inFlight.delete(id);
  }
}

/** Picks up due pending/retrying rows (startup recovery + every minute). */
async function sweep() {
  const [rows] = await db.query(
    `SELECT id FROM email_logs
     WHERE status IN ('pending','retrying') AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
     ORDER BY id LIMIT 20`
  );
  for (const r of rows) await processLog(r.id).catch((e) => console.error('[email] sweep item failed:', e.message));
}

let timer = null;
exports.start = () => {
  sweep().catch((e) => console.error('[email] startup recovery failed:', e.message));
  timer = setInterval(() => sweep().catch((e) => console.error('[email] sweep failed:', e.message)), SWEEP_EVERY_MS);
  timer.unref();
};
exports.stop = () => { if (timer) clearInterval(timer); timer = null; };

/** Manual retry of a failed email from the admin log. */
exports.retry = async (id) => {
  const [r] = await db.execute(
    "UPDATE email_logs SET status = 'pending', attempts = 0, error = NULL, next_attempt_at = NULL WHERE id = ? AND status = 'failed'",
    [id]
  );
  if (!r.affectedRows) {
    const [[row]] = await db.execute('SELECT status FROM email_logs WHERE id = ?', [id]);
    if (!row) throw new HttpError(404, 'Email log not found');
    throw new HttpError(400, `Only failed emails can be retried (this one is ${row.status})`);
  }
  await processLog(id);
  return exports.getLog(id);
};

// ---------------------------------------------------------------- logs
const LOG_COLS = `e.id, e.lead_id, e.site_id, s.name AS site_name, s.color AS site_color, e.smtp_source, e.to_addresses,
  e.cc_addresses, e.bcc_addresses, e.subject, e.status, e.attempts, e.next_attempt_at, e.error, e.created_at, e.sent_at`;
const shapeLog = (r) => ({ ...r, to_addresses: parseList(r.to_addresses), cc_addresses: parseList(r.cc_addresses), bcc_addresses: parseList(r.bcc_addresses) });

exports.getLog = async (id) => {
  const [[row]] = await db.execute(`SELECT ${LOG_COLS} FROM email_logs e LEFT JOIN sites s ON s.id = e.site_id WHERE e.id = ?`, [id]);
  return row ? shapeLog(row) : null;
};

exports.listLogs = async (f) => {
  const where = [];
  const params = [];
  if (f.site_id) { where.push('e.site_id = ?'); params.push(f.site_id); }
  if (f.status) { where.push('e.status = ?'); params.push(f.status); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM email_logs e ${w}`, params);
  const limit = Number(f.page_size);
  const offset = (Number(f.page) - 1) * limit;
  const [rows] = await db.execute(
    `SELECT ${LOG_COLS} FROM email_logs e LEFT JOIN sites s ON s.id = e.site_id ${w} ORDER BY e.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  return { data: rows.map(shapeLog), total: Number(total), page: f.page, page_size: f.page_size };
};

// ---------------------------------------------------------------- test mail
/**
 * Sends a test email with the posted config (blank password = saved one) or the saved config.
 * Uses a fresh, uncached transporter and reports the real SMTP error.
 */
exports.sendTest = async ({ to, config }, savedRaw, label) => {
  let cfg;
  if (config) {
    settings.assertAllowedHost(config.host);
    let pass = config.password;
    if (!pass) {
      if (!savedRaw?.password_enc) throw new HttpError(400, 'Enter the SMTP password (none is saved yet)', { password: 'Password is required' });
      // Never send the saved password to a different server/account than the one it was saved for.
      if (!settings.sameServer(savedRaw, config)) throw new HttpError(400, 'Enter the password: the server or username differs from the saved settings', { password: 'Password is required for a different server' });
      pass = decrypt(savedRaw.password_enc);
    }
    cfg = { ...config, pass };
  } else {
    if (!savedRaw?.host || !savedRaw?.password_enc) throw new HttpError(400, 'No SMTP settings saved yet');
    cfg = { ...savedRaw, pass: decrypt(savedRaw.password_enc) };
  }
  const transport = nodemailer.createTransport(transportOptions(cfg));
  try {
    const info = await transport.sendMail({
      from: { name: cfg.from_name, address: cfg.from_email },
      to,
      subject: `Test email from Central Leads Panel (${label})`,
      text: `This is a test email from Central Leads Panel.\n\nSMTP: ${cfg.host}:${cfg.port} (${cfg.secure ? 'SSL/TLS' : 'STARTTLS'})\nIf you received this, the ${label} SMTP settings work.`,
    });
    return { success: true, message: `Test email accepted by ${cfg.host} for ${to}`, response: String(info.response || '').slice(0, 300) };
  } catch (err) {
    throw new HttpError(400, `SMTP error: ${smtpErrorMessage(err, cfg.pass)}`);
  } finally {
    transport.close();
  }
};

exports._internals = { processLog, sweep, resolveSmtp };
