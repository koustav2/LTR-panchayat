'use strict';

const express = require('express');

const config = require('../config');
const { query, queryOne, transaction } = require('../db');
const { encryptAadhaar, hashAadhaar, maskAadhaar, decryptAadhaar } = require('../lib/crypto');
const { nextReferenceNo } = require('../lib/reference');
const { audit } = require('../lib/audit');
const { requireAuth, requireRole } = require('../middleware/auth');
const { STATUS, OPEN_STATUSES, isStatus, zeroCounts } = require('../lib/status');
const {
  ApiError,
  cleanAadhaar,
  cleanPhone,
  cleanPin,
  cleanName,
  cleanAmount,
  cleanId,
  cleanYesNo,
  cleanComment,
} = require('../lib/validate');

const router = express.Router();
router.use(requireAuth);

const PAGE_SIZE = 20;

/** Both reviewers see every application and every money total. */
const REVIEWER_ROLES = ['head_sahayak', 'mla'];

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
    const amount = cleanAmount(b.amount, 'Amount');

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
    const year = new Date().getFullYear();

    // "Already open" now means either verification stage. An application
    // sitting with the Head Sahayak is just as much a live request as one
    // sitting with the MLA.
    const openList = OPEN_STATUSES.map(() => '?').join(', ');

    const created = await transaction(async (conn) => {
      // Find or create the beneficiary. One Aadhaar, one row, forever.
      const [existingRows] = await conn.execute(
        'SELECT id FROM beneficiaries WHERE aadhaar_hash = ? FOR UPDATE',
        [aadhaarHash]
      );

      // The duplicate guard runs *inside* the transaction, after the row lock
      // above. Outside it, two supervisors submitting for the same person at
      // the same instant could both read "no duplicate" and both commit.
      if (config.duplicatePendingPolicy !== 'off' && existingRows.length) {
        const [dupes] = await conn.execute(
          `SELECT reference_no
             FROM applications
            WHERE beneficiary_id = ?
              AND support_type_id = ?
              AND status IN (${openList})
            LIMIT 1`,
          [existingRows[0].id, supportTypeId, ...OPEN_STATUSES]
        );
        const dupe = dupes[0];
        if (dupe && config.duplicatePendingPolicy === 'block') {
          throw new ApiError(
            409,
            `This Aadhaar already has an open application of the same support type (${dupe.reference_no}).`
          );
        }
        if (dupe && !b.acknowledgeDuplicate) {
          const err = new ApiError(
            409,
            `This Aadhaar already has an open application of the same support type (${dupe.reference_no}). Submit again to confirm.`,
            undefined
          );
          err.duplicateOf = dupe.reference_no;
          throw err;
        }
      }

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

      // Every new application starts with the Head Sahayak. There is no path
      // that puts one straight in front of the MLA.
      const [appIns] = await conn.execute(
        `INSERT INTO applications
           (reference_no, beneficiary_id,
            applicant_name, guardian_name, phone,
            block_id, panchayat_id, pin_code,
            support_type_id, support_reason_id, amount,
            pp_recommend, pp_comment, ms_recommend, ms_comment, mp_recommend, mp_comment,
            status, submitted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          amount,
          ppRecommend,
          ppComment,
          msRecommend,
          msComment,
          mpRecommend,
          mpComment,
          STATUS.PENDING_HEAD,
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
        status: STATUS.PENDING_HEAD,
      },
    });
  } catch (err) {
    // The duplicate warning is a 409 the client answers by resubmitting with
    // acknowledgeDuplicate. It is thrown from inside the transaction so the
    // rollback happens, and reshaped into its response here.
    if (err instanceof ApiError && err.duplicateOf) {
      return res.status(409).json({
        error: err.message,
        duplicateOf: err.duplicateOf,
        needsAcknowledgement: true,
      });
    }
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
  // editing the request. Both reviewer roles see everything.
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
  if (isStatus(status)) {
    where.push('a.status = ?');
    params.push(status);
  } else if (status === 'open') {
    // Convenience filter for "anything still moving", used by the dashboards.
    where.push(`a.status IN (${OPEN_STATUSES.map(() => '?').join(', ')})`);
    params.push(...OPEN_STATUSES);
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
      `SELECT a.id, a.reference_no, a.status, a.rejection_reason, a.mla_comment,
              a.head_comment, a.submitted_at, a.reviewed_at, a.head_reviewed_at,
              a.applicant_name, a.guardian_name, a.phone,
              a.amount, a.approved_amount, bn.aadhaar_last4,
              bl.name AS block_name, p.name AS panchayat_name,
              st.name AS support_type, sr.name AS support_reason,
              u.full_name AS submitted_by_name,
              hv.full_name AS head_reviewed_by_name
         FROM applications a
         JOIN beneficiaries bn   ON bn.id = a.beneficiary_id
         JOIN blocks bl          ON bl.id = a.block_id
         JOIN panchayats p       ON p.id  = a.panchayat_id
         JOIN support_types st   ON st.id = a.support_type_id
         JOIN support_reasons sr ON sr.id = a.support_reason_id
         JOIN users u            ON u.id  = a.submitted_by
         LEFT JOIN users hv      ON hv.id = a.head_reviewed_by
         ${where}
         ORDER BY a.submitted_at DESC, a.id DESC
         LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      params
    );

    // Counts are deliberately *unfiltered* (beyond role scoping): they drive
    // the filter chips, which need to say how many are in each bucket overall,
    // not how many survive the filter already applied.
    const statusCounts = await query(
      `SELECT a.status, COUNT(*) AS n
         FROM applications a
         ${req.user.role === 'supervisor' ? 'WHERE a.submitted_by = ?' : ''}
         GROUP BY a.status`,
      req.user.role === 'supervisor' ? [req.user.id] : []
    );

    const counts = zeroCounts();
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
        mlaComment: r.mla_comment,
        headComment: r.head_comment,
        submittedAt: r.submitted_at,
        reviewedAt: r.reviewed_at,
        headReviewedAt: r.head_reviewed_at,
        headReviewedByName: r.head_reviewed_by_name,
        fullName: r.applicant_name,
        guardianName: r.guardian_name,
        phone: r.phone,
        aadhaarMasked: maskAadhaar(r.aadhaar_last4),
        blockName: r.block_name,
        panchayatName: r.panchayat_name,
        supportType: r.support_type,
        supportReason: r.support_reason,
        amount: Number(r.amount),
        // null until the MLA decides — the client shows a dash, never a zero,
        // because "sanctioned nothing yet" and "sanctioned ₹0" are different.
        approvedAmount: r.approved_amount == null ? null : Number(r.approved_amount),
        submittedByName: r.submitted_by_name,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Amount rollup by block and panchayat (Head Sahayak + MLA)                    */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/applications/summary
 *
 * Money totals grouped by block, then panchayat. Two different quantities are
 * tracked and they must never be conflated:
 *
 *   requested  — `amount`, what the supervisor filed for
 *   sanctioned — `approved_amount`, what the MLA actually granted
 *
 * The MLA may sanction more or less than was requested, so the difference
 * between the two is real information and is reported as `variance`.
 *
 *   requested = awaitingHead + awaitingMla + requestedOnAccepted
 *
 * Rejected applications — by the Head Sahayak or by the MLA — are excluded from
 * `requested`: once turned down, that is no longer money being asked for. Each
 * gets its own line so the figure stays visible rather than vanishing.
 *
 * SUM() over DECIMAL comes back from MySQL as a string; it is converted once,
 * here, so every consumer gets a number.
 */
router.get('/summary', requireRole(...REVIEWER_ROLES), async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT a.block_id, bl.name AS block_name, bl.sort_order AS block_order,
              a.panchayat_id, p.name AS panchayat_name, p.sort_order AS panchayat_order,

              SUM(CASE WHEN a.status = 'pending_head'  THEN a.amount ELSE 0 END) AS awaiting_head,
              SUM(CASE WHEN a.status = 'pending_mla'   THEN a.amount ELSE 0 END) AS awaiting_mla,
              SUM(CASE WHEN a.status = 'head_rejected' THEN a.amount ELSE 0 END) AS head_rejected,
              SUM(CASE WHEN a.status = 'rejected'      THEN a.amount ELSE 0 END) AS mla_rejected,

              -- Both sides of an accepted application: what was asked for, and
              -- what was granted. The gap between them is the MLA's adjustment.
              SUM(CASE WHEN a.status = 'accepted' THEN a.amount ELSE 0 END)                        AS accepted_requested,
              SUM(CASE WHEN a.status = 'accepted' THEN COALESCE(a.approved_amount, 0) ELSE 0 END)  AS sanctioned,

              SUM(a.status = 'pending_head')  AS awaiting_head_count,
              SUM(a.status = 'pending_mla')   AS awaiting_mla_count,
              SUM(a.status = 'head_rejected') AS head_rejected_count,
              SUM(a.status = 'rejected')      AS mla_rejected_count,
              SUM(a.status = 'accepted')      AS accepted_count,
              COUNT(*) AS total_count
         FROM applications a
         JOIN blocks bl    ON bl.id = a.block_id
         JOIN panchayats p ON p.id  = a.panchayat_id
        GROUP BY a.block_id, bl.name, bl.sort_order,
                 a.panchayat_id, p.name, p.sort_order
        ORDER BY bl.sort_order, bl.name, p.sort_order, p.name`
    );

    const blocks = [];
    const byBlock = new Map();

    const zero = () => ({
      awaitingHead: 0, awaitingMla: 0,
      acceptedRequested: 0, sanctioned: 0,
      headRejected: 0, mlaRejected: 0,
      requested: 0, variance: 0,
      awaitingHeadCount: 0, awaitingMlaCount: 0,
      acceptedCount: 0, headRejectedCount: 0, mlaRejectedCount: 0,
      openCount: 0, totalCount: 0,
    });

    const add = (t, r) => {
      const awaitingHead = Number(r.awaiting_head);
      const awaitingMla = Number(r.awaiting_mla);
      const acceptedRequested = Number(r.accepted_requested);
      const sanctioned = Number(r.sanctioned);

      t.awaitingHead += awaitingHead;
      t.awaitingMla += awaitingMla;
      t.acceptedRequested += acceptedRequested;
      t.sanctioned += sanctioned;
      t.headRejected += Number(r.head_rejected);
      t.mlaRejected += Number(r.mla_rejected);

      // Everything not turned down, valued at what was asked for.
      t.requested += awaitingHead + awaitingMla + acceptedRequested;
      // Positive = the MLA granted more than was asked; negative = deducted.
      t.variance += sanctioned - acceptedRequested;

      t.awaitingHeadCount += Number(r.awaiting_head_count);
      t.awaitingMlaCount += Number(r.awaiting_mla_count);
      t.acceptedCount += Number(r.accepted_count);
      t.headRejectedCount += Number(r.head_rejected_count);
      t.mlaRejectedCount += Number(r.mla_rejected_count);
      t.openCount += Number(r.awaiting_head_count) + Number(r.awaiting_mla_count);
      t.totalCount += Number(r.total_count);
    };

    const overall = zero();

    rows.forEach((r) => {
      if (!byBlock.has(r.block_id)) {
        const b = { blockId: r.block_id, blockName: r.block_name, panchayats: [], ...zero() };
        byBlock.set(r.block_id, b);
        blocks.push(b);
      }
      const block = byBlock.get(r.block_id);

      const panchayat = {
        panchayatId: r.panchayat_id,
        panchayatName: r.panchayat_name,
        ...zero(),
      };
      add(panchayat, r);
      block.panchayats.push(panchayat);

      add(block, r);
      add(overall, r);
    });

    res.json({ overall, blocks });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* CSV export (Head Sahayak + MLA)                                             */
/* -------------------------------------------------------------------------- */

const STATUS_LABEL = {
  [STATUS.PENDING_HEAD]:  'Verification pending — Head Sahayak',
  [STATUS.PENDING_MLA]:   'Awaiting MLA decision',
  [STATUS.HEAD_REJECTED]: 'Rejected by Head Sahayak',
  [STATUS.ACCEPTED]:      'Accepted',
  [STATUS.REJECTED]:      'Rejected by MLA',
};

router.get('/export.csv', requireRole(...REVIEWER_ROLES), async (req, res, next) => {
  try {
    const { where, params } = buildListFilters(req);
    const rows = await query(
      `SELECT a.reference_no, a.status, a.rejection_reason, a.mla_comment,
              a.head_comment, a.submitted_at, a.head_reviewed_at, a.reviewed_at,
              a.applicant_name, a.guardian_name, a.phone, bn.aadhaar_last4, a.pin_code,
              bl.name AS block_name, p.name AS panchayat_name,
              st.name AS support_type, sr.name AS support_reason,
              a.amount, a.approved_amount,
              a.pp_recommend, a.pp_comment, a.ms_recommend, a.ms_comment,
              a.mp_recommend, a.mp_comment,
              u.full_name AS submitted_by_name,
              hv.full_name AS head_reviewed_by_name,
              rv.full_name AS reviewed_by_name
         FROM applications a
         JOIN beneficiaries bn   ON bn.id = a.beneficiary_id
         JOIN blocks bl          ON bl.id = a.block_id
         JOIN panchayats p       ON p.id  = a.panchayat_id
         JOIN support_types st   ON st.id = a.support_type_id
         JOIN support_reasons sr ON sr.id = a.support_reason_id
         JOIN users u            ON u.id  = a.submitted_by
         LEFT JOIN users hv      ON hv.id = a.head_reviewed_by
         LEFT JOIN users rv      ON rv.id = a.reviewed_by
         ${where}
         ORDER BY a.submitted_at DESC
         LIMIT 10000`,
      params
    );

    const headers = [
      'Reference No', 'Stage', 'Submitted At', 'Name', 'Father/Husband Name',
      'Phone', 'Aadhaar (last 4)', 'PIN', 'Block', 'Panchayat',
      'Type of Support', 'Reason of Support',
      'Amount Requested', 'Amount Sanctioned', 'Difference',
      'Head Sahayak', 'Head Verified At', 'Head Comment',
      'MLA', 'MLA Decided At', 'Rejection Reason', 'MLA Comment',
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
      const sanctioned = r.approved_amount == null ? null : Number(r.approved_amount);
      // Only meaningful once a sanction exists; blank otherwise rather than a
      // misleading zero.
      const diff = sanctioned == null ? '' : (sanctioned - Number(r.amount)).toFixed(2);

      lines.push([
        r.reference_no, STATUS_LABEL[r.status] || r.status, r.submitted_at,
        r.applicant_name, r.guardian_name, r.phone, r.aadhaar_last4, r.pin_code,
        r.block_name, r.panchayat_name, r.support_type, r.support_reason,
        r.amount, sanctioned == null ? '' : sanctioned.toFixed(2), diff,
        r.head_reviewed_by_name, r.head_reviewed_at, r.head_comment,
        r.reviewed_by_name, r.reviewed_at, r.rejection_reason, r.mla_comment,
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
              hv.full_name AS head_reviewed_by_name,
              rv.full_name AS reviewed_by_name
         FROM applications a
         JOIN beneficiaries bn   ON bn.id = a.beneficiary_id
         JOIN blocks bl          ON bl.id = a.block_id
         JOIN panchayats p       ON p.id  = a.panchayat_id
         JOIN support_types st   ON st.id = a.support_type_id
         JOIN support_reasons sr ON sr.id = a.support_reason_id
         JOIN users u            ON u.id  = a.submitted_by
         LEFT JOIN users hv      ON hv.id = a.head_reviewed_by
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

        headComment: row.head_comment,
        headReviewedAt: row.head_reviewed_at,
        headReviewedByName: row.head_reviewed_by_name,

        rejectionReason: row.rejection_reason,
        mlaComment: row.mla_comment,
        reviewedAt: row.reviewed_at,
        reviewedByName: row.reviewed_by_name,

        submittedAt: row.submitted_at,
        submittedByName: row.submitted_by_name,

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
        amount: Number(row.amount),
        approvedAmount: row.approved_amount == null ? null : Number(row.approved_amount),
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
/* Stage 2 — Head Sahayak verification                                         */
/* -------------------------------------------------------------------------- */

/**
 * PATCH /api/applications/:id/verify   { decision: 'forward' | 'reject', comment }
 *
 * The Head Sahayak either forwards the application to the MLA or rejects it.
 * A comment is required either way — the whole point of the stage is that the
 * MLA (on a forward) or the supervisor (on a rejection) can see the reasoning.
 *
 * Only an application still sitting at pending_head can be verified, so a
 * decision cannot be re-made or applied on top of the MLA's.
 */
router.patch('/:id/verify', requireRole('head_sahayak'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'Invalid application id.');

    const decision = String(req.body.decision || '').toLowerCase();
    if (!['forward', 'reject'].includes(decision)) {
      throw new ApiError(400, 'Decision must be forward or reject.');
    }

    const comment = String(req.body.comment || '').trim();
    if (comment.length < 3) {
      throw new ApiError(
        400,
        decision === 'forward'
          ? 'A comment is required when sending an application to the MLA.'
          : 'A reason is required when rejecting an application.'
      );
    }
    if (comment.length > 2000) {
      throw new ApiError(400, 'Comment is too long (maximum 2000 characters).');
    }

    const existing = await queryOne(
      'SELECT id, status, reference_no FROM applications WHERE id = ?',
      [id]
    );
    if (!existing) throw new ApiError(404, 'Application not found.');
    if (existing.status !== STATUS.PENDING_HEAD) {
      throw new ApiError(
        409,
        existing.status === STATUS.PENDING_MLA
          ? 'This application has already been sent to the MLA.'
          : 'This application has already been decided.'
      );
    }

    const next_ = decision === 'forward' ? STATUS.PENDING_MLA : STATUS.HEAD_REJECTED;

    // The status guard is repeated in the UPDATE so a concurrent verify loses
    // cleanly rather than overwriting the first one's decision.
    const result = await query(
      `UPDATE applications
          SET status = ?, head_comment = ?, head_reviewed_by = ?, head_reviewed_at = NOW()
        WHERE id = ? AND status = ?`,
      [next_, comment, req.user.id, id, STATUS.PENDING_HEAD]
    );
    if (result.affectedRows === 0) {
      throw new ApiError(409, 'This application was verified by someone else a moment ago.');
    }

    await audit(req, {
      entity: 'application',
      entityId: id,
      action: `head_${decision}`,
      detail: { referenceNo: existing.reference_no, comment },
    });

    res.json({ ok: true, status: next_ });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Stage 3 — MLA decision                                                      */
/* -------------------------------------------------------------------------- */

/**
 * PATCH /api/applications/:id/status
 *   { status: 'accepted' | 'rejected', approvedAmount, rejectionReason, comment }
 *
 * Only an application the Head Sahayak has forwarded can be decided. One
 * already rejected by the head is visible to the MLA but not actionable — that
 * rejection is final.
 *
 * On acceptance the MLA sets the amount actually sanctioned. It defaults to
 * the requested amount but may be raised or lowered; it must be greater than
 * zero, because an acceptance worth nothing is a rejection with extra steps.
 */
router.patch('/:id/status', requireRole('mla'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'Invalid application id.');

    const status = String(req.body.status || '').toLowerCase();
    if (![STATUS.ACCEPTED, STATUS.REJECTED].includes(status)) {
      throw new ApiError(400, 'Status must be accepted or rejected.');
    }

    const reason = String(req.body.rejectionReason || '').trim();
    if (status === STATUS.REJECTED && reason.length < 3) {
      throw new ApiError(400, 'A reason is required when rejecting an application.');
    }

    // Optional note the MLA can leave with either decision. On a rejection the
    // required reason is separate; this is anything further they want on record.
    const comment = String(req.body.comment || '').trim();
    if (comment.length > 2000) {
      throw new ApiError(400, 'Comment is too long (maximum 2000 characters).');
    }

    const existing = await queryOne(
      'SELECT id, status, reference_no, amount FROM applications WHERE id = ?',
      [id]
    );
    if (!existing) throw new ApiError(404, 'Application not found.');

    if (existing.status === STATUS.PENDING_HEAD) {
      throw new ApiError(409, 'The Head Sahayak has not verified this application yet.');
    }
    if (existing.status === STATUS.HEAD_REJECTED) {
      throw new ApiError(409, 'This application was rejected by the Head Sahayak.');
    }
    if (existing.status !== STATUS.PENDING_MLA) {
      throw new ApiError(409, `This application was already ${existing.status}.`);
    }

    // Defaults to what was asked for, so accepting without touching the field
    // sanctions the full amount.
    const approvedAmount =
      status === STATUS.ACCEPTED
        ? cleanAmount(
            req.body.approvedAmount === undefined || req.body.approvedAmount === null || req.body.approvedAmount === ''
              ? existing.amount
              : req.body.approvedAmount,
            'Amount sanctioned'
          )
        : null;

    const result = await query(
      `UPDATE applications
          SET status = ?, approved_amount = ?, rejection_reason = ?, mla_comment = ?,
              reviewed_by = ?, reviewed_at = NOW()
        WHERE id = ? AND status = ?`,
      [
        status,
        approvedAmount,
        status === STATUS.REJECTED ? reason : null,
        comment || null,
        req.user.id,
        id,
        STATUS.PENDING_MLA,
      ]
    );
    if (result.affectedRows === 0) {
      throw new ApiError(409, 'This application was decided by someone else a moment ago.');
    }

    await audit(req, {
      entity: 'application',
      entityId: id,
      action: `review_${status}`,
      detail: {
        referenceNo: existing.reference_no,
        requestedAmount: String(existing.amount),
        approvedAmount,
        reason: status === STATUS.REJECTED ? reason : null,
        comment: comment || null,
      },
    });

    res.json({ ok: true, status, approvedAmount: approvedAmount == null ? null : Number(approvedAmount) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
