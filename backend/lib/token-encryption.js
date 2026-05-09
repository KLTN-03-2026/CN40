/**
 * token-encryption.js
 * AES-256-GCM symmetric encryption for storing OAuth refresh tokens at rest.
 * Key source priority: TOKEN_ENCRYPTION_KEY env (64-char hex) → derived from JWT_SECRET.
 * Output format: "<iv_hex>:<auth_tag_hex>:<ciphertext_hex>"
 */

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

/**
 * Returns a 32-byte Buffer key.
 * Falls back to SHA-256 of JWT_SECRET if TOKEN_ENCRYPTION_KEY is absent/invalid.
 * @returns {Buffer}
 */
function getKey() {
  const keyHex = (process.env.TOKEN_ENCRYPTION_KEY || '').trim();
  if (keyHex.length === 64) {
    return Buffer.from(keyHex, 'hex');
  }
  // Dev fallback: derive deterministic key from JWT_SECRET
  const secret = process.env.JWT_SECRET || 'dev-fallback-secret';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * @param {string} text
 * @returns {string} "<iv_hex>:<tag_hex>:<ciphertext_hex>"
 */
function encrypt(text) {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM ciphertext string.
 * @param {string} data  "<iv_hex>:<tag_hex>:<ciphertext_hex>"
 * @returns {string} plaintext
 * @throws if data is malformed or tag verification fails
 */
function decrypt(data) {
  if (!data || typeof data !== 'string') {
    throw new Error('token-encryption: decrypt received invalid input');
  }

  const parts = data.split(':');
  if (parts.length !== 3) {
    throw new Error('token-encryption: unexpected ciphertext format');
  }

  const [ivHex, tagHex, encrypted] = parts;
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };
