'use strict';

const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  charset: 'utf8mb4',
  dateStrings: ['DATE'],
});

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/**
 * A deadlock is not a bug and not a user's problem — InnoDB picks a victim and
 * says so ("try restarting transaction"). Submitting an application does exactly
 * that: `SELECT ... FOR UPDATE` on an Aadhaar that does not exist yet takes a
 * *gap* lock, gap locks are mutually compatible, and then every one of those
 * transactions tries to INSERT into the same gap. Several supervisors filing for
 * the same new person in the same instant will collide, and one of them loses.
 *
 * Losing is fine. Showing a field worker a 500 is not.
 */
const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

/**
 * Run `fn` inside a transaction. Commits on success, rolls back on any throw,
 * and retries the whole thing on a lock conflict. The callback receives the
 * dedicated connection — every statement inside must use it, otherwise it runs
 * on a different connection and outside the transaction.
 *
 * A retry re-runs `fn` from the top against a clean slate: the rollback undid
 * everything the failed attempt did, including any reference number it had
 * allocated, so no sequence number is burned and nothing is applied twice.
 */
async function transaction(fn, { attempts = 4 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      try {
        await conn.rollback();
      } catch {
        /* connection already gone */
      }
      if (!RETRYABLE.has(err.code) || attempt >= attempts) throw err;
      // Jittered backoff. Without the jitter the losers of one collision line
      // up and collide with each other again on the way back in.
      const backoffMs = 15 * attempt + Math.floor(Math.random() * 25);
      // eslint-disable-next-line no-console
      console.warn(`[db] ${err.code} on attempt ${attempt}; retrying in ${backoffMs}ms`);
      await new Promise((r) => setTimeout(r, backoffMs));
    } finally {
      // Runs before the next iteration, so a retry always starts from a fresh
      // connection rather than reusing one mid-rollback.
      conn.release();
    }
  }
}

async function waitForDatabase(attempts = 30, delayMs = 2000) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      // eslint-disable-next-line no-console
      console.log(`[db] not ready (${err.code || err.message}); retry ${i}/${attempts}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

module.exports = { pool, query, queryOne, transaction, waitForDatabase };
