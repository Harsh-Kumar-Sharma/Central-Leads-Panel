'use strict';
class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.expose = true;
    if (details) this.details = details;
  }
}
module.exports = HttpError;
