'use strict';

/**
 * The application lifecycle, in one place.
 *
 *   supervisor submits
 *        |
 *        v
 *   PENDING_HEAD  --- head rejects (comment) --->  HEAD_REJECTED   (terminal)
 *        |
 *        | head forwards (comment)
 *        v
 *   PENDING_MLA   --- MLA rejects (reason)   --->  REJECTED        (terminal)
 *        |
 *        | MLA accepts (approved_amount, optional comment)
 *        v
 *     ACCEPTED                                                     (terminal)
 *
 * Nothing moves backwards. A head rejection never reaches the MLA for a
 * decision — the MLA can see it, with the head's comment, but cannot act on it.
 */

const STATUS = {
  PENDING_HEAD:  'pending_head',
  PENDING_MLA:   'pending_mla',
  HEAD_REJECTED: 'head_rejected',
  ACCEPTED:      'accepted',
  REJECTED:      'rejected',
};

const ALL_STATUSES = Object.values(STATUS);

/** Still moving. Used by the duplicate guard and by "money still being asked for". */
const OPEN_STATUSES = [STATUS.PENDING_HEAD, STATUS.PENDING_MLA];

/** Turned down by anyone. */
const REJECTED_STATUSES = [STATUS.HEAD_REJECTED, STATUS.REJECTED];

const isStatus = (v) => ALL_STATUSES.includes(String(v || '').toLowerCase());

/** Zeroed counters, so every consumer gets all five keys whether or not the
 *  database returned a row for them. */
const zeroCounts = () =>
  ALL_STATUSES.reduce((acc, s) => {
    acc[s] = 0;
    return acc;
  }, {});

module.exports = { STATUS, ALL_STATUSES, OPEN_STATUSES, REJECTED_STATUSES, isStatus, zeroCounts };
