#!/usr/bin/env bash
# After restore-wiped-apps.sh, some restored rows can point at a panchayat_id
# that no longer exists: the panchayat list was dropped and re-seeded between the
# backup and the restore, and the AUTO_INCREMENT ids came out different. The
# rows still carry the OLD ids.
#
# panchayats have a UNIQUE (zone_id, name), so the honest way to repair this is
# to look up what each old id was called in the backup, then find the panchayat
# of that same name in the same zone in the live list, and point the row there.
# Anything whose name no longer exists is left alone and reported — those need a
# human decision (the panchayat was renamed or removed), not a guess.
#
# Usage:
#   cd /opt/sahayak
#   ./scripts/fix-orphan-panchayats.sh backups/db-YYYYMMDD-HHMMSS.sql.gz

set -euo pipefail

DB_DUMP="${1:?usage: fix-orphan-panchayats.sh <db-*.sql.gz>}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[ -f "$DB_DUMP" ] || { echo "ERROR: db dump not found: $DB_DUMP" >&2; exit 1; }

# shellcheck disable=SC1091
set -a; . ./.env; set +a
PW="$MYSQL_ROOT_PASSWORD"
DB="${DB_NAME:-lrt_panchayat}"
TMP="${DB}_fixmap_tmp"

m()  { docker compose exec -T db mysql -u root -p"$PW" "$@"; }
mdb() { docker compose exec -T db mysql -u root -p"$PW" "$DB" "$@"; }

echo "==> Loading the backup's panchayat list into throwaway DB: $TMP"
m -e "DROP DATABASE IF EXISTS \`$TMP\`; CREATE DATABASE \`$TMP\` CHARACTER SET utf8mb4;"
gunzip -c "$DB_DUMP" | docker compose exec -T db mysql -u root -p"$PW" "$TMP"

echo
echo "==> Proposed remapping (old id -> name/zone -> new id). Rows with new_id NULL cannot be matched:"
m "$DB" -e "
  SELECT 'application' AS kind, a.id AS row_id, a.panchayat_id AS old_pid,
         op.name AS panchayat_name, a.zone_id, np.id AS new_pid
    FROM applications a
    LEFT JOIN \`$TMP\`.panchayats op ON op.id = a.panchayat_id
    LEFT JOIN panchayats np ON np.zone_id = a.zone_id AND np.name = op.name
   WHERE a.panchayat_id NOT IN (SELECT id FROM panchayats)
  UNION ALL
  SELECT 'beneficiary', b.id, b.panchayat_id,
         op.name, b.zone_id, np.id
    FROM beneficiaries b
    LEFT JOIN \`$TMP\`.panchayats op ON op.id = b.panchayat_id
    LEFT JOIN panchayats np ON np.zone_id = b.zone_id AND np.name = op.name
   WHERE b.panchayat_id NOT IN (SELECT id FROM panchayats);"

echo
echo "==> Applying the matches (only rows with a name+zone match are changed)"
mdb -e "
  UPDATE applications a
    JOIN \`$TMP\`.panchayats op ON op.id = a.panchayat_id
    JOIN panchayats np ON np.zone_id = a.zone_id AND np.name = op.name
     SET a.panchayat_id = np.id
   WHERE a.panchayat_id NOT IN (SELECT id FROM (SELECT id FROM panchayats) x);
  UPDATE beneficiaries b
    JOIN \`$TMP\`.panchayats op ON op.id = b.panchayat_id
    JOIN panchayats np ON np.zone_id = b.zone_id AND np.name = op.name
     SET b.panchayat_id = np.id
   WHERE b.panchayat_id NOT IN (SELECT id FROM (SELECT id FROM panchayats) x);"

echo
echo "==> Remaining orphans after the fix (should be empty):"
mdb -e "
  SELECT 'application' AS kind, COUNT(*) AS still_orphaned
    FROM applications a LEFT JOIN panchayats p ON p.id = a.panchayat_id
   WHERE p.id IS NULL
  UNION ALL
  SELECT 'beneficiary', COUNT(*)
    FROM beneficiaries b LEFT JOIN panchayats p ON p.id = b.panchayat_id
   WHERE p.id IS NULL;"

echo
echo "==> Dropping throwaway DB $TMP"
m -e "DROP DATABASE \`$TMP\`;"

echo
echo "Done. If 'still_orphaned' is 0 everywhere, every restored row now points at"
echo "a real panchayat and will show in the list. If any remain, their panchayat"
echo "name no longer exists in the current list (renamed or removed) — share the"
echo "proposed-remapping table above and decide where those rows should point."
