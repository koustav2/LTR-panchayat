-- Adds the Head Sahayak verification stage between the supervisor and the MLA,
-- and the amount the MLA actually sanctions.
--
--   supervisor submits  ->  pending_head
--   head forwards       ->  pending_mla        (comment required)
--   head rejects        ->  head_rejected      (comment required, terminal)
--   MLA accepts         ->  accepted           (approved_amount set)
--   MLA rejects         ->  rejected           (reason required)
--
--   cd /opt/sahayak
--   docker compose exec -T db mysql -u root -p"$MYSQL_ROOT_PASSWORD" lrt_panchayat \
--     < db/migrations/003_head_sahayak.sql
--
-- Safe to run more than once. Existing `pending` applications are treated as
-- already head-verified and land in `pending_mla`, so nothing that was already
-- waiting on the MLA gets pushed back into a stage that did not exist when it
-- was filed.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- 1. The new role
-- ---------------------------------------------------------------------------

SET @role_ok := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'users'
     AND COLUMN_NAME  = 'role'
     AND COLUMN_TYPE LIKE '%head_sahayak%'
);
SET @sql := IF(@role_ok = 0,
  "ALTER TABLE users MODIFY COLUMN role ENUM('supervisor','head_sahayak','mla') NOT NULL",
  'SELECT "users.role already has head_sahayak" AS note'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 2. New columns on applications
-- ---------------------------------------------------------------------------

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                AND COLUMN_NAME = 'head_comment');
SET @sql := IF(@has = 0,
  'ALTER TABLE applications ADD COLUMN head_comment TEXT NULL AFTER mp_comment',
  'SELECT "head_comment already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                AND COLUMN_NAME = 'head_reviewed_by');
SET @sql := IF(@has = 0,
  'ALTER TABLE applications ADD COLUMN head_reviewed_by INT UNSIGNED NULL AFTER head_comment',
  'SELECT "head_reviewed_by already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                AND COLUMN_NAME = 'head_reviewed_at');
SET @sql := IF(@has = 0,
  'ALTER TABLE applications ADD COLUMN head_reviewed_at DATETIME NULL AFTER head_reviewed_by',
  'SELECT "head_reviewed_at already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The amount the MLA actually sanctions. NULL until a decision is made; it may
-- be higher or lower than `amount`, and every money total that describes what
-- was granted reads this column, never `amount`.
SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                AND COLUMN_NAME = 'approved_amount');
SET @sql := IF(@has = 0,
  'ALTER TABLE applications ADD COLUMN approved_amount DECIMAL(12,2) NULL AFTER amount',
  'SELECT "approved_amount already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                AND INDEX_NAME = 'ix_app_head_reviewer');
SET @sql := IF(@has = 0,
  'ALTER TABLE applications ADD INDEX ix_app_head_reviewer (head_reviewed_by)',
  'SELECT "ix_app_head_reviewer already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                AND CONSTRAINT_NAME = 'fk_app_head_reviewer');
SET @sql := IF(@has = 0,
  'ALTER TABLE applications ADD CONSTRAINT fk_app_head_reviewer FOREIGN KEY (head_reviewed_by) REFERENCES users (id)',
  'SELECT "fk_app_head_reviewer already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 3. Widen the status enum, migrate the rows, then narrow it again.
--
-- Widening first means the UPDATE below has somewhere to write. Narrowing
-- afterwards means 'pending' stops being a value anything can produce, so the
-- application code cannot quietly keep using it.
-- ---------------------------------------------------------------------------

SET @done := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'applications'
     AND COLUMN_NAME  = 'status'
     AND COLUMN_TYPE  = "enum('pending_head','pending_mla','head_rejected','accepted','rejected')"
);

SET @sql := IF(@done = 0,
  "ALTER TABLE applications MODIFY COLUMN status
     ENUM('pending','pending_head','pending_mla','head_rejected','accepted','rejected')
     NOT NULL DEFAULT 'pending_head'",
  'SELECT "status enum already migrated" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Existing open applications were filed before this stage existed, so they are
-- treated as already verified and go straight to the MLA.
UPDATE applications SET status = 'pending_mla' WHERE status = 'pending';

-- Anything already accepted was accepted at the full requested amount, because
-- there was no way to change it.
UPDATE applications SET approved_amount = amount
 WHERE status = 'accepted' AND approved_amount IS NULL;

SET @sql := IF(@done = 0,
  "ALTER TABLE applications MODIFY COLUMN status
     ENUM('pending_head','pending_mla','head_rejected','accepted','rejected')
     NOT NULL DEFAULT 'pending_head'",
  'SELECT "status enum already narrowed" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 4. The Head Sahayak account
--
-- Default password: Head@2026#LRT  — CHANGE IT BEFORE GOING LIVE:
--   cd api && npm run hash-password -- "YourNewStrongPassword"
--   UPDATE users SET password_hash = '<paste>' WHERE username = 'head';
--
-- One account for the whole constituency: the Head Sahayak sees every block,
-- so block_id is NULL.
-- ---------------------------------------------------------------------------

INSERT INTO users (full_name, username, role, block_id, password_hash, is_active) VALUES
  ('Head Sahayak', 'head', 'head_sahayak', NULL,
   'scrypt$16384$8$1$cf3f424077799189464e0899cdf97277$d944c830c9eb4dd9a3c9cd5635216c3161c9b14b32fd515df3bf1a7264eda122510bc14d170a22eb71c2e57940021b1a3323b42e4ee234b7b1379ecbfbf252f1', 1)
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), role = VALUES(role);
