-- Adds the requested support amount, plus an index for the block/panchayat
-- rollup on the MLA dashboard.
--
--   cd /opt/sahayak
--   docker compose exec -T db mysql -u root -p"$MYSQL_ROOT_PASSWORD" lrt_panchayat \
--     < db/migrations/002_add_amount.sql
--
-- Safe to run more than once. Existing rows get 0.00.

SET @has_amount := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'applications'
     AND COLUMN_NAME  = 'amount'
);
SET @sql := IF(@has_amount = 0,
  'ALTER TABLE applications ADD COLUMN amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER support_reason_id',
  'SELECT "amount already present" AS note'
);
PREPARE s1 FROM @sql; EXECUTE s1; DEALLOCATE PREPARE s1;

SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'applications'
     AND INDEX_NAME   = 'ix_app_rollup'
);
SET @sql2 := IF(@has_idx = 0,
  'ALTER TABLE applications ADD INDEX ix_app_rollup (block_id, panchayat_id, status)',
  'SELECT "ix_app_rollup already present" AS note'
);
PREPARE s2 FROM @sql2; EXECUTE s2; DEALLOCATE PREPARE s2;
