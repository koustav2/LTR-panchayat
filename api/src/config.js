'use strict';

require('dotenv').config();

const path = require('path');

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`
    );
  }
  return value;
}

const isProd = process.env.NODE_ENV === 'production';

// In production every secret must be set explicitly. In development we fall
// back to fixed values so the stack boots with zero configuration.
const devFallback = (value) => (isProd ? undefined : value);

const config = {
  isProd,
  port: Number(process.env.PORT || 4000),

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'lrt',
    // `??` not `||` — an intentionally empty password must not silently
    // fall back to the default.
    password: process.env.DB_PASSWORD ?? 'lrt',
    database: process.env.DB_NAME || 'lrt_panchayat',
    connectionLimit: Number(process.env.DB_POOL || 10),
  },

  // 32-byte key, hex encoded (64 hex chars). Generate with:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  aadhaarKey: required(
    'AADHAAR_ENC_KEY',
    devFallback('0'.repeat(64))
  ),

  // Separate secret so a leaked lookup hash cannot be brute-forced without it.
  aadhaarPepper: required(
    'AADHAAR_HASH_PEPPER',
    devFallback('dev-pepper-change-me')
  ),

  jwtSecret: required('JWT_SECRET', devFallback('dev-jwt-secret-change-me')),
  jwtTtlSeconds: Number(process.env.JWT_TTL_SECONDS || 60 * 60 * 12),

  cookieName: process.env.COOKIE_NAME || 'lrt_session',
  cookieSecure: process.env.COOKIE_SECURE === 'true' || isProd,

  // Uploads live outside the web root and are streamed through an
  // authenticated route. Never served statically.
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'data', 'uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024),
  maxDocumentsPerApplication: Number(process.env.MAX_DOCUMENTS || 5),

  // Aadhaar numbers in the real world carry a Verhoeff check digit. Turning
  // this on catches typos but rejects invented test numbers.
  validateAadhaarChecksum: process.env.VALIDATE_AADHAAR_CHECKSUM === 'true',

  // 'block' | 'warn' | 'off' — what to do when the same Aadhaar already has a
  // pending application of the same support type.
  duplicatePendingPolicy: process.env.DUPLICATE_PENDING_POLICY || 'warn',

  // Login throttling. Tuneable so that automated test runs (and a busy office
  // sharing one public IP) are not locked out by the default.
  loginRateWindowMinutes: Number(process.env.LOGIN_RATE_WINDOW_MINUTES || 15),
  loginRateMax: Number(process.env.LOGIN_RATE_MAX || 20),

  corsOrigin: process.env.CORS_ORIGIN || '',
};

if (isProd) {
  if (config.aadhaarKey.length !== 64) {
    throw new Error('AADHAAR_ENC_KEY must be 64 hex characters (32 bytes).');
  }
  if (config.jwtSecret.length < 24) {
    throw new Error('JWT_SECRET must be at least 24 characters in production.');
  }
}

module.exports = config;
