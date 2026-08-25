'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const { queryOne, query } = require('../db');
const { hashAadhaar, maskAadhaar } = require('../lib/crypto');
const { cleanAadhaar } = require('../lib/validate');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Aadhaar lookup is an existence oracle, so it is rate limited harder than the
// rest of the API to make enumeration impractical.
const lookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many lookups. Please slow down.' },
});

router.use(requireAuth);

/**
 * GET /api/beneficiaries/lookup?aadhaar=123412341234
 *
 * Drives the autofill. Returns 200 with the stored identity details when the
 * Aadhaar is already registered, or `found: false` when it is new — the
 * supervisor then types the details for the first time.
 */
router.get('/lookup', requireRole('supervisor'), lookupLimiter, async (req, res, next) => {
  try {
    const aadhaar = cleanAadhaar(req.query.aadhaar);
    const hash = hashAadhaar(aadhaar);

    const row = await queryOne(
      `SELECT b.id, b.full_name, b.guardian_name, b.phone, b.block_id, b.panchayat_id,
              b.pin_code, b.aadhaar_last4, b.photo_file_id,
              bl.name AS block_name, p.name AS panchayat_name
         FROM beneficiaries b
         JOIN blocks bl     ON bl.id = b.block_id
         JOIN panchayats p  ON p.id  = b.panchayat_id
        WHERE b.aadhaar_hash = ?`,
      [hash]
    );

    if (!row) {
      return res.json({ found: false });
    }

    const history = await query(
      `SELECT a.id, a.reference_no, a.status, a.submitted_at, st.name AS support_type
         FROM applications a
         JOIN support_types st ON st.id = a.support_type_id
        WHERE a.beneficiary_id = ?
        ORDER BY a.submitted_at DESC
        LIMIT 20`,
      [row.id]
    );

    return res.json({
      found: true,
      beneficiary: {
        id: row.id,
        fullName: row.full_name,
        guardianName: row.guardian_name,
        phone: row.phone,
        blockId: row.block_id,
        blockName: row.block_name,
        panchayatId: row.panchayat_id,
        panchayatName: row.panchayat_name,
        pinCode: row.pin_code,
        photoFileId: row.photo_file_id,
        aadhaarMasked: maskAadhaar(row.aadhaar_last4),
      },
      previousApplications: history.map((h) => ({
        id: h.id,
        referenceNo: h.reference_no,
        status: h.status,
        supportType: h.support_type,
        submittedAt: h.submitted_at,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
