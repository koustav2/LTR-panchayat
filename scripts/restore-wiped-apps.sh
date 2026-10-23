#!/usr/bin/env bash
# Restore application data (applications, beneficiaries, files, the join table
# and the reference counters) from a pre-wipe backup, WITHOUT disturbing the
# master data, the user accounts, or the audit log that the live database has
# accumulated since the backup was taken.
#
# This is for one situation: wipe-applications.sql was run by mistake and the
# rows need to come back from a dump taken moments before. It is NOT a general
# restore tool — it deliberately copies only the five tables the wipe clears.
#
# How it works: the dump is loaded into a throwaway database, then each of the
# five tables is copied row-for-row into the live database. Only columns that
# exist in BOTH schemas are copied, so a dump taken before a later migration
# (e.g. the 005 handover columns) still restores cleanly — the newer columns
# simply stay NULL. The live tables must be empty for this to be safe; the
# script checks and refuses otherwise.
#
# Usage:
#   cd /opt/sahayak
#   ./scripts/restore-wiped-apps.sh backups/db-YYYYMMDD-HHMMSS.sql.gz [backups/uploads-YYYYMMDD-HHMMSS.tar.gz]
#
# The uploads tarball is optional but you almost always want it — without it the
# rows come back but the photos they point at do not.

set -euo pipefail

DB_DUMP="${1:?usage: restore-wiped-apps.sh <db-*.sql.gz> [uploads-*.tar.gz]}"
UPLOADS_TAR="${2:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[ -f "$DB_DUMP" ] || { echo "ERROR: db dump not found: $DB_DUMP" >&2; exit 1; }

# shellcheck disable=SC1091
set -a; . ./.env; set +a
PW="$MYSQL_ROOT_PASSWORD"
DB="${DB_NAME:-lrt_panchayat}"
TMP="${DB}_restore_tmp"

# The five tables the wipe clears, in child-before-parent order for the copy.
TABLES=(files beneficiaries applications application_files reference_counters)

m()  { docker compose exec -T db mysql  -u root -p"$PW" "$@"; }
mdb() { docker compose exec -T db mysql  -u root -p"$PW" "$DB" "$@"; }

echo "==> Safety check: the live tables must be empty before restoring"
LIVE_ROWS="$(mdb -N -B -e "SELECT
  (SELECT COUNT(*) FROM applications)
 +(SELECT COUNT(*) FROM beneficiaries)
 +(SELECT COUNT(*) FROM files)
 +(SELECT COUNT(*) FROM application_files)
 +(SELECT COUNT(*) FROM reference_counters);")"
if [ "$LIVE_ROWS" != "0" ]; then
  echo "ERROR: the live tables are not empty ($LIVE_ROWS rows across the five tables)." >&2
  echo "       This script only restores into an empty set, to avoid duplicating or" >&2
  echo "       colliding with data that is already there. Aborting." >&2
  exit 1
fi

echo "==> Loading dump into throwaway database: $TMP"
m -e "DROP DATABASE IF EXISTS \`$TMP\`; CREATE DATABASE \`$TMP\` CHARACTER SET utf8mb4;"
gunzip -c "$DB_DUMP" | docker compose exec -T db mysql -u root -p"$PW" "$TMP"

echo "==> Rows available in the backup:"
for t in "${TABLES[@]}"; do
  n="$(m -N -B -e "SELECT COUNT(*) FROM \`$TMP\`.\`$t\`;")"
  printf '    %-20s %s\n' "$t" "$n"
done

echo "==> Copying the five tables into $DB (common columns only)"
for t in "${TABLES[@]}"; do
  m "$TMP" -e "
    SET SESSION group_concat_max_len = 1000000;
    SET @cols := (
      SELECT GROUP_CONCAT(CONCAT('\`', a.COLUMN_NAME, '\`') ORDER BY a.ORDINAL_POSITION)
        FROM information_schema.COLUMNS a
        JOIN information_schema.COLUMNS b
          ON  b.TABLE_SCHEMA = '$DB'
          AND b.TABLE_NAME   = a.TABLE_NAME
          AND b.COLUMN_NAME  = a.COLUMN_NAME
       WHERE a.TABLE_SCHEMA = '$TMP'
         AND a.TABLE_NAME   = '$t'
    );
    SET @sql := CONCAT('INSERT INTO \`$DB\`.\`$t\` (', @cols,
                       ') SELECT ', @cols, ' FROM \`$TMP\`.\`$t\`');
    SET FOREIGN_KEY_CHECKS = 0;
    PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
    SET FOREIGN_KEY_CHECKS = 1;
  "
  n="$(m -N -B -e "SELECT COUNT(*) FROM \`$DB\`.\`$t\`;")"
  printf '    %-20s restored, now %s rows\n' "$t" "$n"
done

if [ -n "$UPLOADS_TAR" ]; then
  if [ -f "$UPLOADS_TAR" ]; then
    echo "==> Restoring uploaded files from $UPLOADS_TAR into data/uploads"
    tar xzf "$UPLOADS_TAR" -C "$ROOT/data"
  else
    echo "WARNING: uploads tarball not found: $UPLOADS_TAR (rows restored, photos not)" >&2
  fi
else
  echo "==> No uploads tarball given; skipping photo restore"
fi

echo "==> Verifying foreign keys hold after the copy"
mdb -e "
  SELECT 'apps with missing beneficiary' AS check_name, COUNT(*) AS bad
    FROM applications a LEFT JOIN beneficiaries b ON b.id = a.beneficiary_id
   WHERE b.id IS NULL
  UNION ALL
  SELECT 'apps with missing zone', COUNT(*)
    FROM applications a LEFT JOIN zones z ON z.id = a.zone_id
   WHERE z.id IS NULL
  UNION ALL
  SELECT 'apps with missing panchayat', COUNT(*)
    FROM applications a LEFT JOIN panchayats p ON p.id = a.panchayat_id
   WHERE p.id IS NULL;"

echo "==> Dropping throwaway database $TMP"
m -e "DROP DATABASE \`$TMP\`;"

echo "==> Done. Final live counts:"
mdb -e "SELECT
  (SELECT COUNT(*) FROM applications)       AS applications,
  (SELECT COUNT(*) FROM beneficiaries)      AS beneficiaries,
  (SELECT COUNT(*) FROM files)              AS files,
  (SELECT COUNT(*) FROM application_files)  AS application_files,
  (SELECT COUNT(*) FROM reference_counters) AS counters,
  (SELECT COUNT(*) FROM users)              AS users;"

echo
echo "Restore complete. Reload the site and confirm the applications are listed."
echo "If a 'bad' count above was non-zero, tell the person who ran this BEFORE"
echo "relying on the data — a non-zero there means a row points at master data"
echo "that no longer matches and needs a closer look."
