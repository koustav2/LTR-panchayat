'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const { query, queryOne } = require('../db');
const { verifyPassword } = require('../lib/crypto');
const { ApiError } = require('../lib/validate');
const { audit } = require('../lib/audit');
const {
  signSession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
} = require('../middleware/auth');

const router = express.Router();

const config = require('../config');

const loginLimiter = rateLimit({
  windowMs: config.loginRateWindowMinutes * 60 * 1000,
  max: config.loginRateMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please wait 15 minutes.' },
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!username || !password) {
      throw new ApiError(400, 'Username and password are required.');
    }

    const user = await queryOne(
      'SELECT id, full_name, username, password_hash, role, block_id, is_active FROM users WHERE username = ?',
      [username]
    );

    // Same message and comparable timing whether the username exists or not,
    // so the endpoint cannot be used to discover valid usernames.
    const ok = user && user.is_active && verifyPassword(password, user.password_hash);
    if (!ok) {
      await audit(req, {
        entity: 'auth',
        entityId: username,
        action: 'login_failed',
      });
      throw new ApiError(401, 'Incorrect username or password.');
    }

    await query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

    setSessionCookie(res, signSession(user));
    req.user = user;
    await audit(req, { entity: 'auth', entityId: user.id, action: 'login' });

    res.json({
      user: {
        id: user.id,
        fullName: user.full_name,
        username: user.username,
        role: user.role,
        blockId: user.block_id,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      fullName: req.user.full_name,
      username: req.user.username,
      role: req.user.role,
      blockId: req.user.block_id,
      blockName: req.user.block_name,
    },
    // Server date — the form header shows this rather than the device clock,
    // so a submission cannot be backdated by changing the phone's date.
    serverDate: new Date().toISOString(),
  });
});

module.exports = router;
