const crypto = require('crypto');

function normalizeText(text) {
  return String(text == null ? '' : text).trim().replace(/\s+/gu, ' ');
}

function textHash(text) {
  return crypto
    .createHash('sha1')
    .update(normalizeText(text).toLowerCase(), 'utf8')
    .digest('hex');
}

module.exports = { normalizeText, textHash };
