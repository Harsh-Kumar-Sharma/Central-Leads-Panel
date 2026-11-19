'use strict';
const email = require('./emailService');
const inApp = require('./notificationService');

/**
 * Called after a lead is saved (never for spam). Runs in the background:
 * it must never block or fail the ingest response, so every channel is
 * isolated and errors are only logged.
 *
 * Channels: in-app (rows + live SSE push) and email.
 */
async function notifyNewLead(lead) {
  if (!lead || !lead.id || lead.status === 'spam') return;
  await Promise.allSettled([
    inApp.createForLead(lead.id).catch((e) => console.error(`[notify] in-app for lead #${lead.id} failed:`, e.message)),
    email.queueLeadEmail(lead.id).catch((e) => console.error(`[notify] email for lead #${lead.id} failed:`, e.message)),
  ]);
}

exports.notifyNewLead = notifyNewLead;
exports.notify = notifyNewLead; // backwards-compatible name
