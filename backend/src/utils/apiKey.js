'use strict';
const crypto = require('crypto');
exports.generateApiKey = () => 'sk_' + crypto.randomBytes(32).toString('hex');
exports.isWellFormedKey = (k) => typeof k === 'string' && /^sk_[a-f0-9]{64}$/.test(k);
