'use strict';

/**
 * Password hashing and Aadhaar protection.
 *
 * Passwords use scrypt from Node's built-in crypto module — no native
 * compilation, so the same code runs in Docker, on a VPS and inside cPanel's
 * Node.js App manager without a build toolchain.
 *
 * Aadhaar numbers are stored twice:
 *   aadhaar_enc  — AES-256-GCM ciphertext, reversible, shown only on detail
 *   aadhaar_hash — SHA-256 of (pepper + number), used for lookup
 * The plaintext number is never indexed, so a dump of the index reveals nothing.
 */

const crypto = require('crypto');
const config = require('../config');

const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LEN = 64;

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(plain, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(plain, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltHex, hashHex] = parts;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const derived = crypto.scryptSync(plain, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    // Constant-time compare — a plain === would leak timing information.
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function aadhaarKey() {
  return Buffer.from(config.aadhaarKey, 'hex');
}

function encryptAadhaar(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aadhaarKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv | tag | ciphertext
  return Buffer.concat([iv, tag, enc]);
}

function decryptAadhaar(buf) {
  if (!buf) return null;
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const enc = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', aadhaarKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

function hashAadhaar(plain) {
  return crypto
    .createHash('sha256')
    .update(`${config.aadhaarPepper}:${String(plain)}`)
    .digest('hex');
}

function maskAadhaar(last4) {
  return `XXXX XXXX ${last4 || '____'}`;
}

module.exports = {
  hashPassword,
  verifyPassword,
  encryptAadhaar,
  decryptAadhaar,
  hashAadhaar,
  maskAadhaar,
};
