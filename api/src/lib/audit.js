'use strict';

const { query } = require('../db');

/**
 * Append-only audit trail. Never throws into the request path — a failed audit
 * write must not roll back a successful application submission, but it is
 * logged loudly so the failure is visible.
 */
async function audit(req, { entity, entityId, action, detail }) {
  try {
    await query(
      `INSERT INTO audit_log (user_id, entity, entity_id, action, detail, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.user ? req.user.id : null,
        entity,
        entityId != null ? String(entityId) : null,
        action,
        detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null,
        (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || null,
      ]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] write failed:', err.message);
  }
}

module.exports = { audit };
