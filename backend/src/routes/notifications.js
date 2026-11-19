'use strict';
const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, loadSiteScope } = require('../middleware/auth');
const { idParam } = require('../validators/leadQuery');
const notifications = require('../services/notificationService');
const hub = require('../services/sseHub');

// Every route is about the logged-in user's own notifications, always site-scoped.
const router = express.Router();
router.use(requireAuth, loadSiteScope);

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unread_only: z.enum(['0', '1', 'true', 'false']).optional().transform((v) => v === '1' || v === 'true'),
});
const prefsBody = z.object({
  bell_enabled: z.boolean(),
  site_ids: z.array(z.number().int().positive()).max(500).nullable().default(null),
});

router.get('/', asyncHandler(async (req, res) => {
  res.json(await notifications.list(req.user, req.allowedSiteIds, listQuery.parse(req.query)));
}));

router.get('/unread-count', asyncHandler(async (req, res) => {
  res.json({ unread_count: await notifications.unreadCount(req.user, req.allowedSiteIds) });
}));

router.post('/read-all', asyncHandler(async (req, res) => {
  await notifications.markAllRead(req.user, req.allowedSiteIds);
  res.json({ success: true, unread_count: 0 });
}));

router.post('/:id/read', asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ success: true, unread_count: await notifications.markRead(req.user, req.allowedSiteIds, id) });
}));

router.get('/prefs', asyncHandler(async (req, res) => {
  res.json(await notifications.getPrefs(req.user));
}));

router.put('/prefs', asyncHandler(async (req, res) => {
  res.json(await notifications.savePrefs(req.user, req.allowedSiteIds, prefsBody.parse(req.body)));
}));

/**
 * Live stream (Server-Sent Events). Auth uses the normal `Authorization: Bearer` header,
 * so the client must use a fetch-based SSE reader (the token never goes into the URL,
 * where it would end up in proxy logs and browser history).
 */
router.get('/stream', asyncHandler(async (req, res) => {
  if (!hub.add(req.user.id, res, req.auth)) {
    // 503 (not thrown: the error handler masks 5xx as 500). The client falls back to polling.
    return res.status(503).json({ success: false, message: 'Too many live connections for this user' });
  }
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // tell Nginx not to buffer this response
  });
  req.socket.setKeepAlive(true);
  req.socket.setNoDelay(true);
  res.flushHeaders();
  const unread = await notifications.unreadCount(req.user, req.allowedSiteIds);
  res.write('retry: 5000\n'); // browser-style reconnect hint
  res.write(`event: ready\ndata: ${JSON.stringify({ unread_count: unread })}\n\n`);
}));

module.exports = router;
