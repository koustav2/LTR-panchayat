'use strict';

const express = require('express');

const { query, queryOne } = require('../db');
const { hashPassword } = require('../lib/crypto');
const { ApiError, cleanName, cleanId } = require('../lib/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { audit } = require('../lib/audit');

const router = express.Router();
router.use(requireAuth);

/**
 * Sahayak profile management.
 *
 * The Head Sahayak can create and manage Sahayak (supervisor) accounts from
 * the app — login id, password, block, and an optional email / phone / profile
 * photo. Only supervisor accounts: reviewer accounts (Head Sahayak, MLA) are
 * still seeded by SQL, so a compromised Head Sahayak session cannot mint
 * another reviewer or lock the MLA out.
 */
router.use(requireRole('head_sahayak'));

/** The login id. May be a plain handle (sup.dharma) or an email address. */
function cleanUsername(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v.length < 3) throw new ApiError(400, 'Login id must be at least 3 characters.');
  if (v.length > 60) throw new ApiError(400, 'Login id is too long (maximum 60 characters).');
  if (!/^[a-z0-9@._-]+$/.test(v)) {
    throw new ApiError(400, 'Login id may only contain letters, numbers, dots, dashes, underscores and @.');
  }
  return v;
}

function cleanEmail(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return null;
  if (v.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    throw new ApiError(400, 'That email address does not look right.');
  }
  return v;
}

function cleanOptionalPhone(value) {
  const v = String(value ?? '').replace(/\D/g, '');
  if (!v) return null;
  if (v.length !== 10 || !/^[6-9]/.test(v)) {
    throw new ApiError(400, 'Phone number must be 10 digits starting with 6, 7, 8 or 9.');
  }
  return v;
}

function cleanPassword(value) {
  const v = String(value ?? '');
  if (v.length < 8) throw new ApiError(400, 'Password must be at least 8 characters.');
  if (v.length > 200) throw new ApiError(400, 'Password is too long.');
  return v;
}

/** The photo must exist and actually be a profile photo. */
async function checkProfilePhoto(fileId) {
  const photo = await queryOne('SELECT id, kind FROM files WHERE id = ?', [fileId]);
  if (!photo) throw new ApiError(400, 'That profile photo was not found. Please upload it again.');
  if (photo.kind !== 'profile_photo') throw new ApiError(400, 'That file is not a profile photo.');
}

/* -------------------------------------------------------------------------- */
/* List — every Sahayak account                                                */
/* -------------------------------------------------------------------------- */

router.get('/', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT u.id, u.full_name, u.username, u.email, u.phone,
              u.profile_photo_file_id, u.block_id, u.is_active,
              u.last_login_at, u.created_at,
              b.name AS block_name,
              cb.full_name AS created_by_name
         FROM users u
         LEFT JOIN blocks b ON b.id = u.block_id
         LEFT JOIN users cb ON cb.id = u.created_by
        WHERE u.role = 'supervisor'
        ORDER BY u.is_active DESC, u.full_name ASC`
    );

    res.json({
      users: rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        username: r.username,
        email: r.email,
        phone: r.phone,
        profilePhotoFileId: r.profile_photo_file_id,
        blockId: r.block_id,
        blockName: r.block_name,
        isActive: Boolean(r.is_active),
        lastLoginAt: r.last_login_at,
        createdAt: r.created_at,
        createdByName: r.created_by_name,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Create — a new Sahayak account                                              */
/* -------------------------------------------------------------------------- */

router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};

    const fullName = cleanName(b.fullName, 'Name');
    const username = cleanUsername(b.username);
    const email = cleanEmail(b.email);
    const phone = cleanOptionalPhone(b.phone);
    const password = cleanPassword(b.password);
    const blockId = cleanId(b.blockId, 'Block');
    const profilePhotoFileId = b.profilePhotoFileId
      ? cleanId(b.profilePhotoFileId, 'Profile photo')
      : null;

    const block = await queryOne('SELECT id FROM blocks WHERE id = ? AND is_active = 1', [blockId]);
    if (!block) throw new ApiError(400, 'Please choose a valid Block.');

    const taken = await queryOne('SELECT id FROM users WHERE username = ?', [username]);
    if (taken) throw new ApiError(409, 'That login id is already in use.');

    if (profilePhotoFileId) await checkProfilePhoto(profilePhotoFileId);

    const result = await query(
      `INSERT INTO users
         (full_name, username, email, phone, profile_photo_file_id,
          password_hash, role, block_id, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'supervisor', ?, 1, ?)`,
      [fullName, username, email, phone, profilePhotoFileId, hashPassword(password), blockId, req.user.id]
    );

    await audit(req, {
      entity: 'user',
      entityId: result.insertId,
      action: 'create_sahayak',
      detail: { username, fullName, blockId },
    });

    res.status(201).json({ user: { id: result.insertId, fullName, username } });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Update — details, password reset, activate / deactivate                     */
/* -------------------------------------------------------------------------- */

router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'Invalid user id.');

    // Only Sahayak accounts can be managed here — never another reviewer, and
    // never the caller's own account by a sideways route.
    const existing = await queryOne(
      "SELECT id, username, role FROM users WHERE id = ? AND role = 'supervisor'",
      [id]
    );
    if (!existing) throw new ApiError(404, 'Sahayak account not found.');

    const b = req.body || {};
    const sets = [];
    const params = [];
    const changed = {};

    if (b.fullName !== undefined) {
      sets.push('full_name = ?');
      params.push(cleanName(b.fullName, 'Name'));
      changed.fullName = true;
    }
    if (b.email !== undefined) {
      sets.push('email = ?');
      params.push(cleanEmail(b.email));
      changed.email = true;
    }
    if (b.phone !== undefined) {
      sets.push('phone = ?');
      params.push(cleanOptionalPhone(b.phone));
      changed.phone = true;
    }
    if (b.blockId !== undefined) {
      const blockId = cleanId(b.blockId, 'Block');
      const block = await queryOne('SELECT id FROM blocks WHERE id = ? AND is_active = 1', [blockId]);
      if (!block) throw new ApiError(400, 'Please choose a valid Block.');
      sets.push('block_id = ?');
      params.push(blockId);
      changed.blockId = true;
    }
    if (b.profilePhotoFileId !== undefined) {
      const fileId = b.profilePhotoFileId ? cleanId(b.profilePhotoFileId, 'Profile photo') : null;
      if (fileId) await checkProfilePhoto(fileId);
      sets.push('profile_photo_file_id = ?');
      params.push(fileId);
      changed.profilePhoto = true;
    }
    if (b.password !== undefined && b.password !== '') {
      sets.push('password_hash = ?');
      params.push(hashPassword(cleanPassword(b.password)));
      changed.password = true;
    }
    if (b.isActive !== undefined) {
      sets.push('is_active = ?');
      params.push(b.isActive ? 1 : 0);
      changed.isActive = Boolean(b.isActive);
    }

    if (!sets.length) throw new ApiError(400, 'Nothing to update.');

    await query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);

    await audit(req, {
      entity: 'user',
      entityId: id,
      action: 'update_sahayak',
      detail: { username: existing.username, changed },
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
