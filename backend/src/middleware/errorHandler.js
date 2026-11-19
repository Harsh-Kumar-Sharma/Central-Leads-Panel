'use strict';
const { ZodError } = require('zod');

function zodToErrors(err) {
  const errors = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

exports.notFound = (req, res) => res.status(404).json({ success: false, message: 'Not found' });

// eslint-disable-next-line no-unused-vars
exports.errorHandler = (err, req, res, next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ success: false, errors: zodToErrors(err) });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Payload too large' });
  }
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ success: false, message: 'Invalid JSON body' });
  }
  if (err.expose && err.status && err.status < 500) {
    const body = { success: false, message: err.message };
    if (err.details) body.errors = err.details;
    return res.status(err.status).json(body);
  }
  // Never leak internals: log server-side, return a generic message.
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  return res.status(500).json({ success: false, message: 'Internal server error' });
};

exports.zodToErrors = zodToErrors;
