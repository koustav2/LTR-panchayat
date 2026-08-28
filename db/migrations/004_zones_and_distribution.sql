-- Adds the Zone tier between Block and Panchayat, and the record of an approved
-- application's money actually reaching the applicant.
--
--   cd /opt/sahayak
--   ./scripts/backup.sh
--   docker compose exec -T db mysql -u root -p"$MYSQL_ROOT_PASSWORD" lrt_panchayat \
--     < db/migrations/004_zones_and_distribution.sql
--
-- Safe to run more than once.
--
-- IMPORTANT — read before running on live data.
--
-- Zones are a new NOT NULL column on `panchayats`, `beneficiaries` and
-- `applications`, and there is no way to infer which zone an existing row
-- belonged to: the zone did not exist when it was written. This migration
-- therefore expects the application data to have been cleared first, by
-- `scripts/wipe-applications.sql`. It re-seeds the panchayat list from scratch
-- because the old flat list has no zone to belong to.
--
-- Run in this order:
--   1. scripts/backup.sh                    take a backup, this is destructive
--   2. db/scripts/wipe-applications.sql     clears applications, beneficiaries, files
--   3. this file                            adds zones and the distribution columns
--   4. db/scripts/reset-address-lists.sql   drops the old flat panchayat list
--   5. db/init/002_seed_master.sql          seeds 2 blocks / 6 zones / 60 panchayats
--
-- Step 2 runs before this file on purpose, and works on either schema. Step 4
-- runs after, because the old panchayat rows have no zone they can honestly
-- belong to and are replaced rather than backfilled.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- 1. The zones table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS zones (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  block_id    INT UNSIGNED NOT NULL,
  name        VARCHAR(120) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_zone_block_name (block_id, name),
  KEY ix_zone_block (block_id),
  CONSTRAINT fk_zone_block FOREIGN KEY (block_id) REFERENCES blocks (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed the zones now, because everything below needs somewhere to point.
INSERT INTO zones (id, block_id, name, sort_order) VALUES
  (1, 1, 'Dharmasala Zone 1', 1),
  (2, 1, 'Dharmasala Zone 2', 2),
  (3, 1, 'Dharmasala Zone 3', 3),
  (4, 2, 'Rasulpur Zone 1', 1),
  (5, 2, 'Rasulpur Zone 2', 2),
  (6, 2, 'Rasulpur Zone 3', 3)
ON DUPLICATE KEY UPDATE name = VALUES(name), sort_order = VALUES(sort_order);

-- The block was seeded as 'Rasulpur Dharasamal'; the zone and panchayat names
-- use 'Rasulpur'. Align it. The `code` is untouched — it is baked into every
-- reference number ever issued.
UPDATE blocks SET name = 'Rasulpur' WHERE code = 'RSD';

-- ---------------------------------------------------------------------------
-- 2. panchayats.zone_id
--
-- Added nullable, backfilled to the block's first zone, then made NOT NULL.
-- The backfill is a placeholder: the real assignment comes from re-running
-- db/init/002_seed_master.sql, which rewrites the whole list.
-- ---------------------------------------------------------------------------

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'panchayats'
                AND COLUMN_NAME = 'zone_id');
SET @sql := IF(@has = 0,
  'ALTER TABLE panchayats ADD COLUMN zone_id INT UNSIGNED NULL AFTER block_id',
  'SELECT "panchayats.zone_id already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

UPDATE panchayats p
   SET p.zone_id = (SELECT MIN(z.id) FROM zones z WHERE z.block_id = p.block_id)
 WHERE p.zone_id IS NULL;

SET @nullable := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'panchayats'
                     AND COLUMN_NAME = 'zone_id');
SET @sql := IF(@nullable = 'YES',
  'ALTER TABLE panchayats MODIFY COLUMN zone_id INT UNSIGNED NOT NULL',
  'SELECT "panchayats.zone_id already NOT NULL" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'panchayats'
                AND INDEX_NAME = 'ix_panchayat_zone');
SET @sql := IF(@has = 0,
  'ALTER TABLE panchayats ADD INDEX ix_panchayat_zone (zone_id)',
  'SELECT "ix_panchayat_zone already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'panchayats'
                AND CONSTRAINT_NAME = 'fk_panchayat_zone');
SET @sql := IF(@has = 0,
  'ALTER TABLE panchayats ADD CONSTRAINT fk_panchayat_zone FOREIGN KEY (zone_id) REFERENCES zones (id)',
  'SELECT "fk_panchayat_zone already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Panchayat names are now unique per zone rather than per block, because
-- numbering restarts inside a block only if somebody chooses to.
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'panchayats'
                AND INDEX_NAME = 'uq_panchayat_zone_name');
SET @sql := IF(@has = 0,
  'ALTER TABLE panchayats ADD UNIQUE KEY uq_panchayat_zone_name (zone_id, name)',
  'SELECT "uq_panchayat_zone_name already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'panchayats'
                AND INDEX_NAME = 'uq_panchayat_block_name');
SET @sql := IF(@has > 0,
  'ALTER TABLE panchayats DROP INDEX uq_panchayat_block_name',
  'SELECT "uq_panchayat_block_name already dropped" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 3. beneficiaries.zone_id and applications.zone_id
-- ---------------------------------------------------------------------------

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'beneficiaries'
                AND COLUMN_NAME = 'zone_id');
SET @sql := IF(@has = 0,
  'ALTER TABLE beneficiaries ADD COLUMN zone_id INT UNSIGNED NULL AFTER block_id',
  'SELECT "beneficiaries.zone_id already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

UPDATE beneficiaries b
   SET b.zone_id = (SELECT p.zone_id FROM panchayats p WHERE p.id = b.panchayat_id)
 WHERE b.zone_id IS NULL;

SET @nullable := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'beneficiaries'
                     AND COLUMN_NAME = 'zone_id');
SET @sql := IF(@nullable = 'YES',
  'ALTER TABLE beneficiaries MODIFY COLUMN zone_id INT UNSIGNED NOT NULL',
  'SELECT "beneficiaries.zone_id already NOT NULL" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'beneficiaries'
                AND CONSTRAINT_NAME = 'fk_beneficiary_zone');
SET @sql := IF(@has = 0,
  'ALTER TABLE beneficiaries ADD CONSTRAINT fk_beneficiary_zone FOREIGN KEY (zone_id) REFERENCES zones (id)',
  'SELECT "fk_beneficiary_zone already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                AND COLUMN_NAME = 'zone_id');
SET @sql := IF(@has = 0,
  'ALTER TABLE applications ADD COLUMN zone_id INT UNSIGNED NULL AFTER block_id',
  'SELECT "applications.zone_id already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

UPDATE applications a
   SET a.zone_id = (SELECT p.zone_id FROM panchayats p WHERE p.id = a.panchayat_id)
 WHERE a.zone_id IS NULL;

SET @nullable := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                     AND COLUMN_NAME = 'zone_id');
SET @sql := IF(@nullable = 'YES',
  'ALTER TABLE applications MODIFY COLUMN zone_id INT UNSIGNED NOT NULL',
  'SELECT "applications.zone_id already NOT NULL" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                AND CONSTRAINT_NAME = 'fk_app_zone');
SET @sql := IF(@has = 0,
  'ALTER TABLE applications ADD CONSTRAINT fk_app_zone FOREIGN KEY (zone_id) REFERENCES zones (id)',
  'SELECT "fk_app_zone already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                AND INDEX_NAME = 'ix_app_zone_rollup');
SET @sql := IF(@has = 0,
  'ALTER TABLE applications ADD INDEX ix_app_zone_rollup (block_id, zone_id, panchayat_id, status)',
  'SELECT "ix_app_zone_rollup already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 4. Distribution — proof that an approved application reached the applicant
--
-- Not a sixth status, on purpose: distribution is a separate axis from the
-- MLA's decision, and folding it into `status` would take distributed money out
-- of the `accepted` totals that get reported upward.
-- ---------------------------------------------------------------------------

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'files'
                AND COLUMN_NAME = 'kind' AND COLUMN_TYPE LIKE '%distribution_photo%');
SET @sql := IF(@has = 0,
  "ALTER TABLE files MODIFY COLUMN kind ENUM('applicant_photo','document','distribution_photo') NOT NULL",
  'SELECT "files.kind already has distribution_photo" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                AND COLUMN_NAME = 'distributed_at');
SET @sql := IF(@has = 0,
  'ALTER TABLE applications
     ADD COLUMN distributed_at DATETIME NULL AFTER reviewed_at,
     ADD COLUMN distributed_by INT UNSIGNED NULL AFTER distributed_at,
     ADD COLUMN distribution_photo_file_id INT UNSIGNED NULL AFTER distributed_by',
  'SELECT "distribution columns already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                AND INDEX_NAME = 'ix_app_distribution');
SET @sql := IF(@has = 0,
  'ALTER TABLE applications ADD INDEX ix_app_distribution (status, distributed_at)',
  'SELECT "ix_app_distribution already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                AND CONSTRAINT_NAME = 'fk_app_distributor');
SET @sql := IF(@has = 0,
  'ALTER TABLE applications ADD CONSTRAINT fk_app_distributor FOREIGN KEY (distributed_by) REFERENCES users (id)',
  'SELECT "fk_app_distributor already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
                AND CONSTRAINT_NAME = 'fk_app_dist_photo');
SET @sql := IF(@has = 0,
  'ALTER TABLE applications ADD CONSTRAINT fk_app_dist_photo FOREIGN KEY (distribution_photo_file_id) REFERENCES files (id)',
  'SELECT "fk_app_dist_photo already present" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
