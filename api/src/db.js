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
 * Run `fn` inside a transaction. Commits on success, rolls back on any throw.
 * The callback receives the dedicated connection — every statement inside must
 * use it, otherwise it runs on a different connection and outside the
 * transaction.
 */
async function transaction(fn) {
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
    throw err;
  } finally {
    conn.release();
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
