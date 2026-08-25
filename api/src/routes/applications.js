'use strict';

const express = require('express');

const config = require('../config');
const { query, queryOne, transaction } = require('../db');
const { encryptAadhaar, hashAadhaar, maskAadhaar, decryptAadhaar } = require('../lib/crypto');
const { nextReferenceNo } = require('../lib/reference');
const { audit } = require('../lib/audit');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  ApiError,
  cleanAadhaar,
  cleanPhone,
  cleanPin,
  cleanName,
  cleanId,
  cleanYesNo,
  cleanComment,
} = require('../lib/validate');

const router = express.Router();
router.use(requireAuth);

const PAGE_SIZE = 20;

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

router.post('/', requireRole('supervisor'), async (req, res, next) => {
  try {
    const b = req.body || {};

    const aadhaar = cleanAadhaar(b.aadhaar);
    const fullName = cleanName(b.fullName, 'Name');
    const guardianName = cleanName(b.guardianName, 'Father / Husband Name');
    const phone = cleanPhone(b.phone);
    const blockId = cleanId(b.blockId, 'Block');
    const panchayatId = cleanId(b.panchayatId, 'Panchayat');
    const pinCode = cleanPin(b.pinCode);
    const supportTypeId = cleanId(b.supportTypeId, 'Type of Support');
    const supportReasonId = cleanId(b.supportReasonId, 'Reason of Support');

    const ppRecommend = cleanYesNo(b.ppRecommend, 'Comments of Panchayat Prabhari');
    const msRecommend = cleanYesNo(b.msRecommend, 'Comments of Mandal Sabhapati');
    const mpRecommend = cleanYesNo(b.mpRecommend, 'Comments of Mandal Prabhari');

    const ppComment = cleanComment(b.ppComment, 'Panchayat Prabhari', {
      requiredWhen: ppRecommend === 'no',
    });
    const msComment = cleanComment(b.msComment, 'Mandal Sabhapati', {
      requiredWhen: msRecommend === 'no',
    });
    const mpComment = cleanComment(b.mpComment, 'Mandal Prabhari', {
      requiredWhen: mpRecommend === 'no',
    });

    const photoFileId = b.photoFileId ? cleanId(b.photoFileId, 'Applicant photo') : null;
    const documentFileIds = Array.isArray(b.documentFileIds)
      ? b.documentFileIds.map((id) => cleanId(id, 'Document')).slice(0, config.maxDocumentsPerApplication)
      : [];

    // Referential sanity: the dependent dropdowns must actually agree. A
    // crafted request could otherwise pair a Dharmasala panchayat with the
    // Rasulpur block, or an Education reason with a Health support type.
    const block = await queryOne('SELECT id, code, name FROM blocks WHERE id = ? AND is_active = 1', [blockId]);
    if (!block) throw new ApiError(400, 'Please choose a valid Block.');

    const panchayat = await queryOne(
      'SELECT id FROM panchayats WHERE id = ? AND block_id = ? AND is_active = 1',
      [panchayatId, blockId]
    );
    if (!panchayat) throw new ApiError(400, 'That Panchayat does not belong to the selected Block.');

    const reason = await queryOne(
      'SELECT id FROM support_reasons WHERE id = ? AND support_type_id = ? AND is_active = 1',
      [supportReasonId, supportTypeId]
    );
    if (!reason) throw new ApiError(400, 'That Reason of Support does not belong to the selected Type of Support.');

    const aadhaarHash = hashAadhaar(aadhaar);

    // Duplicate guard — configurable via DUPLICATE_PENDING_POLICY.
    if (config.duplicatePendingPolicy !== 'off') {
      const dupe = await queryOne(
        `SELECT a.reference_no
           FROM applications a
           JOIN beneficiaries bn ON bn.id = a.beneficiary_id
          WHERE bn.aadhaar_hash = ?
            AND a.support_type_id = ?
            AND a.status = 'pending'
          LIMIT 1`,
        [aadhaarHash, supportTypeId]
      );
      if (dupe && config.duplicatePendingPolicy === 'block') {
        throw new ApiError(
          409,
          `This Aadhaar already has a pending application of the same support type (${dupe.reference_no}).`
        );
      }
      if (dupe && !b.acknowledgeDuplicate) {
        return res.status(409).json({
          error: `This Aadhaar already has a pending application of the same support type (${dupe.reference_no}). Submit again to confirm.`,
          duplicateOf: dupe.reference_no,
          needsAcknowledgement: true,
        });
      }
    }

    const year = new Date().getFullYear();

    const created = await transaction(async (conn) => {
      // Find or create the beneficiary. One Aadhaar, one row, forever.
      const [existingRows] = await conn.execute(
        'SELECT id FROM beneficiaries WHERE aadhaar_hash = ? FOR UPDATE',
        [aadhaarHash]
      );

      let beneficiaryId;
      let isNewBeneficiary = false;

      if (existingRows.length) {
        beneficiaryId = existingRows[0].id;
        // The supervisor may have corrected details on this visit; keep the
        // master record current. The application still snapshots its own copy.
        await conn.execute(
          `UPDATE beneficiaries
              SET full_name = ?, guardian_name = ?, phone = ?, block_id = ?,
                  panchayat_id = ?, pin_code = ?,
                  photo_file_id = COALESCE(?, photo_file_id)
            WHERE id = ?`,
          [fullName, guardianName, phone, blockId, panchayatId, pinCode, photoFileId, beneficiaryId]
        );
      } else {
        isNewBeneficiary = true;
        const [ins] = await conn.execute(
          `INSERT INTO beneficiaries
             (aadhaar_hash, aadhaar_enc, aadhaar_last4, full_name, guardian_name,
              phone, block_id, panchayat_id, pin_code, photo_file_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            aadhaarHash,
            encryptAadhaar(aadhaar),
            aadhaar.slice(-4),
            fullName,
            guardianName,
            phone,
            blockId,
            panchayatId,
            pinCode,
            photoFileId,
            req.user.id,
          ]
        );
        beneficiaryId = ins.insertId;
      }

      const referenceNo = await nextReferenceNo(conn, block.code, year);

      const [appIns] = await conn.execute(
        `INSERT INTO applications
           (reference_no, beneficiary_id,
            applicant_name, guardian_name, phone,
            block_id, panchayat_id, pin_code,
            support_type_id, support_reason_id,
            pp_recommend, pp_comment, ms_recommend, ms_comment, mp_recommend, mp_comment,
            submitted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          referenceNo,
          beneficiaryId,
          fullName,
          guardianName,
          phone,
          blockId,
          panchayatId,
          pinCode,
          supportTypeId,
          supportReasonId,
          ppRecommend,
          ppComment,
          msRecommend,
          msComment,
          mpRecommend,
          mpComment,
          req.user.id,
        ]
      );

      const applicationId = appIns.insertId;

      const attachIds = [...documentFileIds];
      if (photoFileId) attachIds.push(photoFileId);
      for (const fileId of attachIds) {
        await conn.execute(
          'INSERT IGNORE INTO application_files (application_id, file_id) VALUES (?, ?)',
          [applicationId, fileId]
        );
      }

      return { applicationId, referenceNo, beneficiaryId, isNewBeneficiary };
    });

    await audit(req, {
      entity: 'application',
      entityId: created.applicationId,
      action: 'create',
      detail: { referenceNo: created.referenceNo, newBeneficiary: created.isNewBeneficiary },
    });

    return res.status(201).json({
      application: {
        id: created.applicationId,
        referenceNo: created.referenceNo,
        status: 'pending',
      },
    });
  } catch (err) {
    return next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* List                                                                        */
/* -------------------------------------------------------------------------- */

function buildListFilters(req) {
  const where = [];
  const params = [];

  // Role scoping happens here, on the server. A supervisor cannot widen it by
  // editing the request.
  if (req.user.role === 'supervisor') {
    where.push('a.submitted_by = ?');
    params.push(req.user.id);
  } else if (req.query.submittedBy) {
    const id = Number(req.query.submittedBy);
    if (Number.isInteger(id) && id > 0) {
      where.push('a.submitted_by = ?');
      params.push(id);
    }
  }

  const status = String(req.query.status || '').toLowerCase();
  if (['pending', 'accepted', 'rejected'].includes(status)) {
    where.push('a.status = ?');
    params.push(status);
  }

  const blockId = Number(req.query.blockId);
  if (Number.isInteger(blockId) && blockId > 0) {
    where.push('a.block_id = ?');
    params.push(blockId);
  }

  const q = String(req.query.q || '').trim();
  if (q) {
    const digits = q.replace(/\D/g, '');
    // Searches the snapshot on the application, not the beneficiary's current
    // values — so a form is still findable under the name it was filed with.
    const clauses = ['a.reference_no LIKE ?', 'a.applicant_name LIKE ?', 'a.guardian_name LIKE ?'];
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);

    if (digits.length >= 4) {
      clauses.push('a.phone LIKE ?');
      params.push(`%${digits}%`);
      // Searching by the last four Aadhaar digits — the full number is never
      // searchable, by design.
      if (digits.length === 4) {
        clauses.push('bn.aadhaar_last4 = ?');
        params.push(digits);
      }
    }
    where.push(`(${clauses.join(' OR ')})`);
  }

  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

router.get('/', async (req, res, next) => {
  try {
    const { where, params } = buildListFilters(req);

    const page = Math.max(1, Number(req.query.page) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    const countRow = await queryOne(
      `SELECT COUNT(*) AS total
         FROM applications a
         JOIN beneficiaries bn ON bn.id = a.beneficiary_id
         ${where}`,
      params
    );

    // LIMIT / OFFSET are interpolated from validated integers rather than
    // bound, because prepared statements reject placeholders there.
    const rows = await query(
      `SELECT a.id, a.reference_no, a.status, a.rejection_reason, a.submitted_at, a.reviewed_at,
              a.applicant_name, a.guardian_name, a.phone, bn.aadhaar_last4,
              bl.name AS block_name, p.name AS panchayat_name,
              st.name AS support_type, sr.name AS support_reason,
              u.full_name AS submitted_by_name
         FROM applications a
         JOIN beneficiaries bn   ON bn.id = a.beneficiary_id
         JOIN blocks bl          ON bl.id = a.block_id
         JOIN panchayats p       ON p.id  = a.panchayat_id
         JOIN support_types st   ON st.id = a.support_type_id
         JOIN support_reasons sr ON sr.id = a.support_reason_id
         JOIN users u            ON u.id  = a.submitted_by
         ${where}
         ORDER BY a.submitted_at DESC, a.id DESC
         LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      params
    );

    const statusCounts = await query(
      `SELECT a.status, COUNT(*) AS n
         FROM applications a
         ${req.user.role === 'supervisor' ? 'WHERE a.submitted_by = ?' : ''}
         GROUP BY a.status`,
      req.user.role === 'supervisor' ? [req.user.id] : []
    );

    const counts = { pending: 0, accepted: 0, rejected: 0 };
    statusCounts.forEach((r) => {
      counts[r.status] = Number(r.n);
    });

    res.json({
      page,
      pageSize: PAGE_SIZE,
      total: Number(countRow.total),
      counts,
      applications: rows.map((r) => ({
        id: r.id,
        referenceNo: r.reference_no,
        status: r.status,
        rejectionReason: r.rejection_reason,
        submittedAt: r.submitted_at,
        reviewedAt: r.reviewed_at,
        fullName: r.applicant_name,
        guardianName: r.guardian_name,
        phone: r.phone,
        aadhaarMasked: maskAadhaar(r.aadhaar_last4),
        blockName: r.block_name,
        panchayatName: r.panchayat_name,
        supportType: r.support_type,
        supportReason: r.support_reason,
        submittedByName: r.submitted_by_name,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* CSV export (MLA)                                                            */
/* -------------------------------------------------------------------------- */

router.get('/export.csv', requireRole('mla'), async (req, res, next) => {
  try {
    const { where, params } = buildListFilters(req);
    const rows = await query(
      `SELECT a.reference_no, a.status, a.rejection_reason, a.mla_comment, a.submitted_at, a.reviewed_at,
              a.applicant_name, a.guardian_name, a.phone, bn.aadhaar_last4, a.pin_code,
              bl.name AS block_name, p.name AS panchayat_name,
              st.name AS support_type, sr.name AS support_reason,
              a.pp_recommend, a.pp_comment, a.ms_recommend, a.ms_comment,
              a.mp_recommend, a.mp_comment,
              u.full_name AS submitted_by_name
         FROM applications a
         JOIN beneficiaries bn   ON bn.id = a.beneficiary_id
         JOIN blocks bl          ON bl.id = a.block_id
         JOIN panchayats p       ON p.id  = a.panchayat_id
         JOIN support_types st   ON st.id = a.support_type_id
         JOIN support_reasons sr ON sr.id = a.support_reason_id
         JOIN users u            ON u.id  = a.submitted_by
         ${where}
         ORDER BY a.submitted_at DESC
         LIMIT 10000`,
      params
    );

    const headers = [
      'Reference No', 'Status', 'Rejection Reason', 'MLA Comment', 'Submitted At', 'Reviewed At',
      'Name', 'Father/Husband Name', 'Phone', 'Aadhaar (last 4)', 'PIN',
      'Block', 'Panchayat', 'Type of Support', 'Reason of Support',
      'Panchayat Prabhari', 'PP Comment', 'Mandal Sabhapati', 'MS Comment',
      'Mandal Prabhari', 'MP Comment', 'Submitted By',
    ];

    // Guard against CSV formula injection — a name beginning with = or + would
    // otherwise execute when the export is opened in Excel.
    const esc = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };

    const lines = [headers.map(esc).join(',')];
    rows.forEach((r) => {
      lines.push([
        r.reference_no, r.status, r.rejection_reason, r.mla_comment, r.submitted_at, r.reviewed_at,
        r.applicant_name, r.guardian_name, r.phone, r.aadhaar_last4, r.pin_code,
        r.block_name, r.panchayat_name, r.support_type, r.support_reason,
        r.pp_recommend, r.pp_comment, r.ms_recommend, r.ms_comment,
        r.mp_recommend, r.mp_comment, r.submitted_by_name,
      ].map(esc).join(','));
    });

    await audit(req, { entity: 'application', action: 'export_csv', detail: { rows: rows.length } });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sahayak-applications.csv"');
    res.send(`﻿${lines.join('\r\n')}`);
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Detail                                                                      */
/* -------------------------------------------------------------------------- */

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'Invalid application id.');

    const row = await queryOne(
      // a.* already carries the submitted-time applicant_name/guardian_name/phone,
      // so only Aadhaar and the photo are taken from the beneficiary row.
      `SELECT a.*, bn.aadhaar_last4, bn.aadhaar_enc, bn.photo_file_id,
              bl.name AS block_name, p.name AS panchayat_name,
              st.name AS support_type, sr.name AS support_reason,
              u.full_name AS submitted_by_name,
              rv.full_name AS reviewed_by_name
         FROM applications a
         JOIN beneficiaries bn   ON bn.id = a.beneficiary_id
         JOIN blocks bl          ON bl.id = a.block_id
         JOIN panchayats p       ON p.id  = a.panchayat_id
         JOIN support_types st   ON st.id = a.support_type_id
         JOIN support_reasons sr ON sr.id = a.support_reason_id
         JOIN users u            ON u.id  = a.submitted_by
         LEFT JOIN users rv      ON rv.id = a.reviewed_by
        WHERE a.id = ?`,
      [id]
    );

    if (!row) throw new ApiError(404, 'Application not found.');
    if (req.user.role === 'supervisor' && row.submitted_by !== req.user.id) {
      throw new ApiError(403, 'You can only view your own submissions.');
    }

    const files = await query(
      `SELECT f.id, f.kind, f.original_name, f.mime_type, f.size_bytes
         FROM application_files af
         JOIN files f ON f.id = af.file_id
        WHERE af.application_id = ?
        ORDER BY f.kind DESC, f.id`,
      [id]
    );

    // The full Aadhaar is revealed only here, and the reveal is audited.
    let aadhaarFull = null;
    if (String(req.query.revealAadhaar) === 'true') {
      aadhaarFull = decryptAadhaar(row.aadhaar_enc);
      await audit(req, { entity: 'beneficiary', entityId: row.beneficiary_id, action: 'aadhaar_reveal' });
    }

    res.json({
      application: {
        id: row.id,
        referenceNo: row.reference_no,
        status: row.status,
        rejectionReason: row.rejection_reason,
        mlaComment: row.mla_comment,
        submittedAt: row.submitted_at,
        submittedByName: row.submitted_by_name,
        reviewedAt: row.reviewed_at,
        reviewedByName: row.reviewed_by_name,
        fullName: row.applicant_name,
        guardianName: row.guardian_name,
        phone: row.phone,
        aadhaarMasked: maskAadhaar(row.aadhaar_last4),
        aadhaarFull,
        blockName: row.block_name,
        panchayatName: row.panchayat_name,
        pinCode: row.pin_code,
        supportType: row.support_type,
        supportReason: row.support_reason,
        ppRecommend: row.pp_recommend,
        ppComment: row.pp_comment,
        msRecommend: row.ms_recommend,
        msComment: row.ms_comment,
        mpRecommend: row.mp_recommend,
        mpComment: row.mp_comment,
        // A repeat applicant may not re-upload a photo, in which case nothing
        // of kind 'applicant_photo' is attached to *this* application. The
        // beneficiary's stored photo is the right thing to show instead.
        photoFileId: row.photo_file_id,
        files: files.map((f) => ({
          id: f.id,
          kind: f.kind,
          originalName: f.original_name,
          mimeType: f.mime_type,
          sizeBytes: f.size_bytes,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Review — MLA only                                                           */
/* -------------------------------------------------------------------------- */

router.patch('/:id/status', requireRole('mla'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'Invalid application id.');

    const status = String(req.body.status || '').toLowerCase();
    if (!['accepted', 'rejected'].includes(status)) {
      throw new ApiError(400, 'Status must be accepted or rejected.');
    }

    const reason = String(req.body.rejectionReason || '').trim();
    if (status === 'rejected' && reason.length < 3) {
      throw new ApiError(400, 'A reason is required when rejecting an application.');
    }

    // Optional note the MLA can leave with either decision. On a rejection the
    // required reason is separate; this is anything further they want on record.
    const comment = String(req.body.comment || '').trim();
    if (comment.length > 2000) {
      throw new ApiError(400, 'Comment is too long (maximum 2000 characters).');
    }

    const existing = await queryOne('SELECT id, status, reference_no FROM applications WHERE id = ?', [id]);
    if (!existing) throw new ApiError(404, 'Application not found.');
    if (existing.status !== 'pending') {
      throw new ApiError(409, `This application was already ${existing.status}.`);
    }

    await query(
      `UPDATE applications
          SET status = ?, rejection_reason = ?, mla_comment = ?,
              reviewed_by = ?, reviewed_at = NOW()
        WHERE id = ? AND status = 'pending'`,
      [status, status === 'rejected' ? reason : null, comment || null, req.user.id, id]
    );

    await audit(req, {
      entity: 'application',
      entityId: id,
      action: `review_${status}`,
      detail: {
        referenceNo: existing.reference_no,
        reason: status === 'rejected' ? reason : null,
        comment: comment || null,
      },
    });

    res.json({ ok: true, status });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
