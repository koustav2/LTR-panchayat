'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { queryOne } = require('../db');
const { ApiError } = require('../lib/validate');

function signSession(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, username: user.username },
    config.jwtSecret,
    { expiresIn: config.jwtTtlSeconds }
  );
}

function setSessionCookie(res, token) {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    maxAge: config.jwtTtlSeconds * 1000,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(config.cookieName, { path: '/' });
}

/**
 * Populates req.user from the session cookie. The user row is re-read on every
 * request so that deactivating an account in the database takes effect
 * immediately rather than when the token happens to expire.
 */
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies ? req.cookies[config.cookieName] : null;
    if (!token) throw new ApiError(401, 'Please sign in.');

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw new ApiError(401, 'Your session has expired. Please sign in again.');
    }

    const user = await queryOne(
      `SELECT u.id, u.full_name, u.username, u.role, u.block_id, u.is_active,
              b.name AS block_name
         FROM users u
         LEFT JOIN blocks b ON b.id = u.block_id
        WHERE u.id = ?`,
      [payload.sub]
    );

    if (!user || !user.is_active) {
      throw new ApiError(401, 'This account is no longer active.');
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Role gate. Applied on the server for every protected route — the frontend
 * hiding a button is a convenience, not a control.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'Please sign in.'));
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, 'You do not have permission to do that.'));
    }
    return next();
  };
}

module.exports = {
  signSession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireRole,
};
