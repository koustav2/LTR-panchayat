'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const config = require('../config');
const { query, queryOne } = require('../db');
const { ApiError } = require('../lib/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { audit } = require('../lib/audit');

const router = express.Router();

fs.mkdirSync(config.uploadDir, { recursive: true });

const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

/**
 * Magic-number check. An attacker can name a file .jpg and set any MIME type
 * they like, so the first bytes are inspected before the file is accepted.
 */
function sniff(buf) {
  if (buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.subarray(0, 4).toString('ascii') === '%PDF') return 'application/pdf';
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
});

router.use(requireAuth);

/**
 * POST /api/files  (multipart: file, kind)
 * Uploads are stored under UPLOAD_DIR, which lives outside the web root, and
 * are only ever streamed back through the authenticated GET below.
 */
router.post(
  '/',
  requireRole('supervisor'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) throw new ApiError(400, 'No file was uploaded.');

      const kind = req.body.kind === 'applicant_photo' ? 'applicant_photo' : 'document';
      const detected = sniff(req.file.buffer);

      if (!detected || !ALLOWED[detected]) {
        throw new ApiError(400, 'Only JPG, PNG, WEBP or PDF files are accepted.');
      }
      if (kind === 'applicant_photo' && detected === 'application/pdf') {
        throw new ApiError(400, 'The applicant photo must be an image, not a PDF.');
      }

      const stored = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ALLOWED[detected]}`;
      await fs.promises.writeFile(path.join(config.uploadDir, stored), req.file.buffer);

      const result = await query(
        `INSERT INTO files (kind, original_name, stored_name, mime_type, size_bytes, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          kind,
          String(req.file.originalname || 'upload').slice(0, 250),
          stored,
          detected,
          req.file.size,
          req.user.id,
        ]
      );

      await audit(req, { entity: 'file', entityId: result.insertId, action: 'upload', detail: { kind } });

      res.status(201).json({
        file: {
          id: result.insertId,
          kind,
          originalName: req.file.originalname,
          mimeType: detected,
          sizeBytes: req.file.size,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/files/:id — streams the file.
 * A supervisor may only read files attached to their own applications (or ones
 * they uploaded but have not yet attached). The MLA may read any.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'Invalid file id.');

    const file = await queryOne(
      'SELECT id, stored_name, mime_type, original_name, uploaded_by FROM files WHERE id = ?',
      [id]
    );
    if (!file) throw new ApiError(404, 'File not found.');

    if (req.user.role === 'supervisor') {
      const owned = await queryOne(
        `SELECT 1 AS ok
           FROM application_files af
           JOIN applications a ON a.id = af.application_id
          WHERE af.file_id = ? AND a.submitted_by = ?
          LIMIT 1`,
        [id, req.user.id]
      );
      const photoOwned = await queryOne(
        `SELECT 1 AS ok
           FROM beneficiaries b
           JOIN applications a ON a.beneficiary_id = b.id
          WHERE b.photo_file_id = ? AND a.submitted_by = ?
          LIMIT 1`,
        [id, req.user.id]
      );
      if (!owned && !photoOwned && file.uploaded_by !== req.user.id) {
        throw new ApiError(403, 'You do not have access to this file.');
      }
    }

    const full = path.join(config.uploadDir, file.stored_name);
    if (!fs.existsSync(full)) throw new ApiError(404, 'File is missing from storage.');

    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.original_name)}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(full).pipe(res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
