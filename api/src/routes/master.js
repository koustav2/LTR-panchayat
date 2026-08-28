'use strict';

const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

/**
 * The address hierarchy is three levels deep:
 *
 *   Block  ->  Zone  ->  Panchayat
 *
 * Each level's endpoint takes the id of the level above, so the form can load
 * one dropdown at a time. `bootstrap` returns all of it at once, which is what
 * the client actually uses — the individual endpoints exist for debugging and
 * for anything that needs to refresh one list without re-fetching the rest.
 */

router.get('/blocks', async (req, res, next) => {
  try {
    const rows = await query(
      'SELECT id, name, code FROM blocks WHERE is_active = 1 ORDER BY sort_order, name'
    );
    res.json({ blocks: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/zones', async (req, res, next) => {
  try {
    const blockId = Number(req.query.blockId);
    if (!Number.isInteger(blockId) || blockId <= 0) {
      return res.json({ zones: [] });
    }
    const rows = await query(
      `SELECT id, block_id, name
         FROM zones
        WHERE block_id = ? AND is_active = 1
        ORDER BY sort_order, name`,
      [blockId]
    );
    return res.json({ zones: rows });
  } catch (err) {
    return next(err);
  }
});

/**
 * Panchayats hang off a zone, not a block. `blockId` is still accepted as a
 * fallback so an older client (or a bookmarked URL) returns the block's whole
 * list rather than an empty one.
 */
router.get('/panchayats', async (req, res, next) => {
  try {
    const zoneId = Number(req.query.zoneId);
    if (Number.isInteger(zoneId) && zoneId > 0) {
      const rows = await query(
        `SELECT id, block_id, zone_id, name
           FROM panchayats
          WHERE zone_id = ? AND is_active = 1
          ORDER BY sort_order, name`,
        [zoneId]
      );
      return res.json({ panchayats: rows });
    }

    const blockId = Number(req.query.blockId);
    if (Number.isInteger(blockId) && blockId > 0) {
      const rows = await query(
        `SELECT id, block_id, zone_id, name
           FROM panchayats
          WHERE block_id = ? AND is_active = 1
          ORDER BY sort_order, name`,
        [blockId]
      );
      return res.json({ panchayats: rows });
    }

    return res.json({ panchayats: [] });
  } catch (err) {
    return next(err);
  }
});

router.get('/support-types', async (req, res, next) => {
  try {
    const rows = await query(
      'SELECT id, name FROM support_types WHERE is_active = 1 ORDER BY sort_order, name'
    );
    res.json({ supportTypes: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/support-reasons', async (req, res, next) => {
  try {
    const typeId = Number(req.query.typeId);
    if (!Number.isInteger(typeId) || typeId <= 0) {
      return res.json({ supportReasons: [] });
    }
    const rows = await query(
      `SELECT id, support_type_id, name
         FROM support_reasons
        WHERE support_type_id = ? AND is_active = 1
        ORDER BY sort_order, name`,
      [typeId]
    );
    return res.json({ supportReasons: rows });
  } catch (err) {
    return next(err);
  }
});

/**
 * Everything the form needs, in one round trip.
 *
 * All five lists come down together and the client filters them in memory, so
 * changing Block does not cost a request to load its zones — which matters on a
 * patchy rural connection far more than the few kilobytes do. The whole payload
 * is about 6 KB for 2 blocks, 6 zones and 60 panchayats.
 */
router.get('/bootstrap', async (req, res, next) => {
  try {
    const [blocks, zones, panchayats, supportTypes, supportReasons] = await Promise.all([
      query('SELECT id, name, code FROM blocks WHERE is_active = 1 ORDER BY sort_order, name'),
      query('SELECT id, block_id, name FROM zones WHERE is_active = 1 ORDER BY sort_order, name'),
      query(
        `SELECT id, block_id, zone_id, name
           FROM panchayats WHERE is_active = 1 ORDER BY sort_order, name`
      ),
      query('SELECT id, name FROM support_types WHERE is_active = 1 ORDER BY sort_order, name'),
      query('SELECT id, support_type_id, name FROM support_reasons WHERE is_active = 1 ORDER BY sort_order, name'),
    ]);
    res.json({ blocks, zones, panchayats, supportTypes, supportReasons });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
