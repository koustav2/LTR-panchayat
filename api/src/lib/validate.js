'use strict';

const config = require('../config');

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const fail = (message, details) => {
  throw new ApiError(400, message, details);
};

const digitsOnly = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * Verhoeff checksum — the algorithm real Aadhaar numbers use for their final
 * digit. Off by default (see VALIDATE_AADHAAR_CHECKSUM) because invented test
 * numbers will not pass it.
 */
const D_TABLE = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P_TABLE = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

function verhoeffValid(numStr) {
  let c = 0;
  const reversed = numStr.split('').reverse();
  for (let i = 0; i < reversed.length; i += 1) {
    c = D_TABLE[c][P_TABLE[i % 8][Number(reversed[i])]];
  }
  return c === 0;
}

function cleanAadhaar(value, { label = 'Aadhaar number' } = {}) {
  const v = digitsOnly(value);
  if (v.length !== 12) fail(`${label} must be exactly 12 digits.`);
  if (v[0] === '0' || v[0] === '1') fail(`${label} cannot start with 0 or 1.`);
  if (config.validateAadhaarChecksum && !verhoeffValid(v)) {
    fail(`${label} failed its checksum — please re-check the digits.`);
  }
  return v;
}

function cleanPhone(value) {
  const v = digitsOnly(value);
  if (v.length !== 10) fail('Phone number must be exactly 10 digits.');
  if (!/^[6-9]/.test(v)) fail('Phone number must start with 6, 7, 8 or 9.');
  return v;
}

function cleanPin(value) {
  const v = digitsOnly(value);
  if (v.length !== 6) fail('PIN number must be exactly 6 digits.');
  return v;
}

function cleanName(value, label) {
  const v = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (v.length < 2) fail(`${label} is required.`);
  if (v.length > 120) fail(`${label} is too long (maximum 120 characters).`);
  return v;
}

function cleanId(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) fail(`${label} is required.`);
  return n;
}

function cleanYesNo(value, label) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v !== 'yes' && v !== 'no') fail(`${label} must be Yes or No.`);
  return v;
}

function cleanComment(value, label, { requiredWhen = false } = {}) {
  const v = String(value ?? '').trim();
  if (requiredWhen && v.length === 0) {
    fail(`${label} — a comment is required when the answer is No.`);
  }
  if (v.length > 2000) fail(`${label} comment is too long (maximum 2000 characters).`);
  return v || null;
}

module.exports = {
  ApiError,
  fail,
  digitsOnly,
  verhoeffValid,
  cleanAadhaar,
  cleanPhone,
  cleanPin,
  cleanName,
  cleanId,
  cleanYesNo,
  cleanComment,
};
