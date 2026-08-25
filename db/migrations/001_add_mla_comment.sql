-- Adds the MLA's optional comment on a decision.
--
-- `db/init/` only runs against an empty database, so an already-deployed
-- instance needs this applied by hand:
--
--   cd /opt/sahayak
--   docker compose exec -T db mysql -u root -p"$MYSQL_ROOT_PASSWORD" lrt_panchayat \
--     < db/migrations/001_add_mla_comment.sql
--
-- Safe to run more than once.

SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'applications'
     AND COLUMN_NAME  = 'mla_comment'
);

SET @sql := IF(@exists = 0,
  'ALTER TABLE applications ADD COLUMN mla_comment TEXT NULL AFTER rejection_reason',
  'SELECT "mla_comment already present" AS note'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
