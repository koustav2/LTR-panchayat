'use strict';

const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

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

router.get('/panchayats', async (req, res, next) => {
  try {
    const blockId = Number(req.query.blockId);
    if (!Number.isInteger(blockId) || blockId <= 0) {
      return res.json({ panchayats: [] });
    }
    const rows = await query(
      `SELECT id, block_id, name
         FROM panchayats
        WHERE block_id = ? AND is_active = 1
        ORDER BY sort_order, name`,
      [blockId]
    );
    return res.json({ panchayats: rows });
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

/** Everything the form needs, in one round trip. */
router.get('/bootstrap', async (req, res, next) => {
  try {
    const [blocks, panchayats, supportTypes, supportReasons] = await Promise.all([
      query('SELECT id, name, code FROM blocks WHERE is_active = 1 ORDER BY sort_order, name'),
      query('SELECT id, block_id, name FROM panchayats WHERE is_active = 1 ORDER BY sort_order, name'),
      query('SELECT id, name FROM support_types WHERE is_active = 1 ORDER BY sort_order, name'),
      query('SELECT id, support_type_id, name FROM support_reasons WHERE is_active = 1 ORDER BY sort_order, name'),
    ]);
    res.json({ blocks, panchayats, supportTypes, supportReasons });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
