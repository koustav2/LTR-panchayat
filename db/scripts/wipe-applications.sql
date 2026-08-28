-- Clears every application, beneficiary and uploaded-file record, and resets
-- the reference-number counters so numbering restarts at 000001.
--
-- KEEPS the four user accounts. Master data (blocks, zones, panchayats, support
-- types and reasons) is left alone — re-run db/init/002_seed_master.sql
-- afterwards if you also want the lists rewritten.
--
-- THIS IS IRREVERSIBLE. Take a backup first:
--
--   cd /opt/sahayak
--   ./scripts/backup.sh
--   docker compose exec -T db mysql -u root -p"$MYSQL_ROOT_PASSWORD" lrt_panchayat \
--     < db/scripts/wipe-applications.sql
--
-- The rows go in child-before-parent order so the foreign keys stay satisfied
-- without disabling them. Nothing here is conditional: running it twice simply
-- deletes nothing the second time.
--
-- The files on disk are NOT removed by this script — the database has no reach
-- into the filesystem. Clear them separately:
--
--   docker compose exec api sh -c 'rm -f /data/uploads/*'
--   # or, on the host:  rm -f /opt/sahayak/data/uploads/*
--
-- Do that AFTER this script succeeds, so a failed wipe does not leave rows
-- pointing at files that no longer exist.

SET NAMES utf8mb4;

-- The join table first: it points at both applications and files.
DELETE FROM application_files;

-- applications.distribution_photo_file_id and beneficiaries.photo_file_id both
-- reference `files`, so those references have to be dropped before the file
-- rows can go.
--
-- The distribution column only exists after migration 004, and this script has
-- to run on either schema — it is the step that makes migration 004 possible in
-- the first place. So it is cleared conditionally.
SET @has_dist := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'
     AND COLUMN_NAME = 'distribution_photo_file_id'
);
SET @sql := IF(@has_dist > 0,
  'UPDATE applications SET distribution_photo_file_id = NULL',
  'SELECT "no distribution column on this schema yet" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

UPDATE beneficiaries SET photo_file_id = NULL;

START TRANSACTION;

DELETE FROM applications;
DELETE FROM beneficiaries;
DELETE FROM files;

-- Reference numbers restart at LRT/<CODE>/<year>/000001.
DELETE FROM reference_counters;

-- The audit log is deliberately left intact: it is the record of who did what,
-- and clearing the applications does not un-happen any of it. To clear it too:
--   DELETE FROM audit_log;

COMMIT;

SELECT
  (SELECT COUNT(*) FROM applications)       AS applications,
  (SELECT COUNT(*) FROM beneficiaries)      AS beneficiaries,
  (SELECT COUNT(*) FROM files)              AS files,
  (SELECT COUNT(*) FROM application_files)  AS application_files,
  (SELECT COUNT(*) FROM reference_counters) AS counters,
  (SELECT COUNT(*) FROM users)              AS users_kept;
