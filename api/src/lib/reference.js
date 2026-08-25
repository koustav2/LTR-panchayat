'use strict';

/**
 * Reference number generation.
 *
 * Format: LRT/<BLOCK CODE>/<YEAR>/<6-digit sequence>   e.g. LRT/DHM/2026/000123
 *
 * The sequence comes from reference_counters, locked with SELECT ... FOR UPDATE
 * inside the caller's transaction. Two supervisors submitting at the same
 * instant therefore serialise on that row instead of both reading the same
 * value. The UNIQUE index on applications.reference_no is the backstop.
 *
 * Must be called with the transaction's own connection.
 */

const PREFIX = 'LRT';

async function nextReferenceNo(conn, blockCode, year) {
  const yr = Number(year);

  // Create the counter row if this is the first application for this
  // block/year. INSERT IGNORE keeps it safe under concurrency.
  await conn.execute(
    'INSERT IGNORE INTO reference_counters (block_code, year, last_seq) VALUES (?, ?, 0)',
    [blockCode, yr]
  );

  const [rows] = await conn.execute(
    'SELECT last_seq FROM reference_counters WHERE block_code = ? AND year = ? FOR UPDATE',
    [blockCode, yr]
  );

  const next = Number(rows[0].last_seq) + 1;

  await conn.execute(
    'UPDATE reference_counters SET last_seq = ? WHERE block_code = ? AND year = ?',
    [next, blockCode, yr]
  );

  return `${PREFIX}/${blockCode}/${yr}/${String(next).padStart(6, '0')}`;
}

module.exports = { nextReferenceNo, PREFIX };
