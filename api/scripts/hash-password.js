#!/usr/bin/env node
'use strict';

/**
 * Generate a password hash for seeding or resetting an account.
 *
 *   npm run hash-password -- "SomeStrongPassword"
 *
 * Then, on the server:
 *   UPDATE users SET password_hash = '<paste>' WHERE username = 'mla';
 */

const { hashPassword } = require('../src/lib/crypto');

const plain = process.argv[2];

if (!plain) {
  console.error('Usage: npm run hash-password -- "YourPassword"');
  process.exit(1);
}

if (plain.length < 8) {
  console.error('Refusing to hash a password shorter than 8 characters.');
  process.exit(1);
}

console.log(hashPassword(plain));
