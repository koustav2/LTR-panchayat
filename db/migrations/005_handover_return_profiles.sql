-- Handover-for-distribution, return-of-money, and Sahayak profiles.
--
--   cd /opt/sahayak
--   ./scripts/backup.sh
--   docker compose exec -T db mysql -u root -p"$MYSQL_ROOT_PASSWORD" lrt_panchayat \
--     < db/migrations/005_handover_return_profiles.sql
--
-- Safe to run more than once. Non-destructive: every column is added nullable
-- and existing rows keep working.
--
-- What changes:
--
--   1. After the MLA accepts, the Head Sahayak now explicitly hands the money
--      over for distribution (handed_over_at / handed_over_by). Only then can
--      the Sahayak upload the distribution photo — and only the Sahayak can.
--
--   2. If distribution cannot be completed, the Sahayak records a return of
--      the money with a photo and a remark (returned_* columns). Visible to
--      the Head Sahayak and the MLA.
--
--   3. The Head Sahayak can create Sahayak (supervisor) profiles in the app:
--      login id, password, optional email / phone / profile photo.
--
-- Applications already marked distributed before this migration never went
-- through an explicit handover; their handed_over_at is backfilled from
-- distributed_at so the history reads sensibly.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- 1. files.kind — two new kinds
-- ---------------------------------------------------------------------------

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'files'
                AND COLUMN_NAME = 'kind' AND COLUMN_TYPE LIKE '%return_photo%');
SET @sql := IF(@has = 0,
  "ALTER TABLE files MODIFY COLUMN kind ENUM('applicant_photo','document','distribution_photo','return_photo','profile_photo') NOT NULL",
  'SELECT "files.kind already has return_photo / profile_photo" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 2. applications — handover columns
-- ---------------------------------------------------------------------------

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                AND COLUMN_NAME = 'handed_over_at');
SET @sql := IF(@has = 0,
  'ALTER TABLE applications
     ADD COLUMN handed_over_at DATETIME NULL AFTER reviewed_at,
     ADD COLUMN handed_over_by INT UNSIGNED NULL AFTER handed_over_at',
  'SELECT "handover columns already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                AND CONSTRAINT_NAME = 'fk_app_handover_by');
SET @sql := IF(@has = 0,
  'ALTER TABLE applications ADD CONSTRAINT fk_app_handover_by FOREIGN KEY (handed_over_by) REFERENCES users (id)',
  'SELECT "fk_app_handover_by already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Already-distributed applications predate the explicit handover step; date
-- the handover to the distribution so neither step reads as skipped.
UPDATE applications
   SET handed_over_at = distributed_at,
       handed_over_by = distributed_by
 WHERE distributed_at IS NOT NULL AND handed_over_at IS NULL;

SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                AND INDEX_NAME = 'ix_app_handover');
SET @sql := IF(@has = 0,
  'ALTER TABLE applications ADD INDEX ix_app_handover (status, handed_over_at, distributed_at)',
  'SELECT "ix_app_handover already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 3. applications — return-of-money columns
-- ---------------------------------------------------------------------------

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                AND COLUMN_NAME = 'returned_at');
SET @sql := IF(@has = 0,
  'ALTER TABLE applications
     ADD COLUMN returned_at DATETIME NULL AFTER distribution_photo_file_id,
     ADD COLUMN returned_by INT UNSIGNED NULL AFTER returned_at,
     ADD COLUMN return_photo_file_id INT UNSIGNED NULL AFTER returned_by,
     ADD COLUMN return_remark TEXT NULL AFTER return_photo_file_id',
  'SELECT "return columns already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                AND CONSTRAINT_NAME = 'fk_app_returned_by');
SET @sql := IF(@has = 0,
  'ALTER TABLE applications ADD CONSTRAINT fk_app_returned_by FOREIGN KEY (returned_by) REFERENCES users (id)',
  'SELECT "fk_app_returned_by already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                AND CONSTRAINT_NAME = 'fk_app_return_photo');
SET @sql := IF(@has = 0,
  'ALTER TABLE applications ADD CONSTRAINT fk_app_return_photo FOREIGN KEY (return_photo_file_id) REFERENCES files (id)',
  'SELECT "fk_app_return_photo already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 4. users — profile fields for Sahayak accounts created in the app
-- ---------------------------------------------------------------------------

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
                AND COLUMN_NAME = 'email');
SET @sql := IF(@has = 0,
  'ALTER TABLE users
     ADD COLUMN email VARCHAR(190) NULL AFTER username,
     ADD COLUMN phone VARCHAR(10) NULL AFTER email,
     ADD COLUMN profile_photo_file_id INT UNSIGNED NULL AFTER phone,
     ADD COLUMN created_by INT UNSIGNED NULL AFTER last_login_at',
  'SELECT "user profile columns already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
                AND CONSTRAINT_NAME = 'fk_users_profile_photo');
SET @sql := IF(@has = 0,
  'ALTER TABLE users ADD CONSTRAINT fk_users_profile_photo FOREIGN KEY (profile_photo_file_id) REFERENCES files (id)',
  'SELECT "fk_users_profile_photo already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
                AND CONSTRAINT_NAME = 'fk_users_created_by');
SET @sql := IF(@has = 0,
  'ALTER TABLE users ADD CONSTRAINT fk_users_created_by FOREIGN KEY (created_by) REFERENCES users (id)',
  'SELECT "fk_users_created_by already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
