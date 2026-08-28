-- Replaces the Block / Zone / Panchayat lists wholesale.
--
-- Needed once, when moving from the old flat block->panchayat list to the
-- three-level block->zone->panchayat one: the old panchayat rows have no zone
-- they can honestly belong to, so they are removed rather than guessed at.
--
--   docker compose exec -T db mysql -u root -p"$MYSQL_ROOT_PASSWORD" lrt_panchayat \
--     < db/scripts/reset-address-lists.sql
--   docker compose exec -T db mysql -u root -p"$MYSQL_ROOT_PASSWORD" lrt_panchayat \
--     < db/init/002_seed_master.sql
--
-- DO NOT run this casually. It deletes every panchayat and zone, including any
-- real names somebody has typed in. Renaming one is an UPDATE; retiring one is
-- `is_active = 0`. This script is for the structural change only.

SET NAMES utf8mb4;

-- Guard. Applications and beneficiaries both reference panchayats, so this can
-- only run against an already-cleared database. If anything still references
-- them the next statement fails with a table-not-found error naming the
-- problem — crude, but SQL has no cleaner way to abort a plain script, and a
-- loud stop beats a foreign-key error nobody reads.
SET @refs := (SELECT COUNT(*) FROM applications) + (SELECT COUNT(*) FROM beneficiaries);
SET @sql := IF(@refs > 0,
  'SELECT * FROM ERROR_applications_or_beneficiaries_still_exist__run_wipe_applications_sql_first',
  'SELECT "no references — safe to reset the address lists" AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

DELETE FROM panchayats;
DELETE FROM zones;

-- Restart the ids so a re-seed produces the same numbering every time. Zones
-- and panchayats are referenced only by the rows just cleared, so this is safe
-- here and nowhere else.
ALTER TABLE panchayats AUTO_INCREMENT = 1;
ALTER TABLE zones      AUTO_INCREMENT = 1;

SELECT (SELECT COUNT(*) FROM zones) AS zones_left,
       (SELECT COUNT(*) FROM panchayats) AS panchayats_left;
