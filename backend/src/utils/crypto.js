'use strict';
const crypto = require('crypto');
const env = require('../config/env');
const HttpError = require('./httpError');

// Format: "v1:" + base64( iv[12] | authTag[16] | ciphertext )
const PREFIX = 'v1:';
const AAD = Buffer.from('central-leads-panel:secret');

function key() {
  if (!env.ENCRYPTION_KEY) throw new HttpError(500, 'Server encryption key is not configured (SECRET_ENCRYPTION_KEY).');
  return env.ENCRYPTION_KEY;
}

/** Encrypts a secret with AES-256-GCM. */
exports.encrypt = (plain) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(AAD);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
};

/** Decrypts a value produced by encrypt(). Throws if tampered or the key changed. */
exports.decrypt = (payload) => {
  if (typeof payload !== 'string' || !payload.startsWith(PREFIX)) throw new Error('Invalid encrypted value');
  const buf = Buffer.from(payload.slice(PREFIX.length), 'base64');
  if (buf.length < 29) throw new Error('Invalid encrypted value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  decipher.setAAD(AAD);
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
};
