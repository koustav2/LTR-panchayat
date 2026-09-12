#!/usr/bin/env bash
# Add a Zone (and, optionally, its Gram Panchayats) to a Block, live.
#
# Interactive:
#   ./scripts/add-zone.sh
#
# Non-interactive (block name or id, zone name, then GPs as extra args):
#   ./scripts/add-zone.sh Dharmasala "ZONE-16" "FIRST GP" "SECOND GP"
#   ./scripts/add-zone.sh 1 "ZONE-16"
#
# The change is live immediately — the form reads the master lists per request,
# so no restart is needed. Existing rows are never touched: re-running with a
# zone name that already exists just reuses it and appends any new panchayats.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
set -a; [ -f .env ] && . ./.env; set +a
DB_NAME="${DB_NAME:-lrt_panchayat}"

# Run SQL inside the db container, where $MYSQL_ROOT_PASSWORD already exists.
db() {
  docker compose exec -T db sh -c \
    'exec mysql -u root -p"$MYSQL_ROOT_PASSWORD" --batch --skip-column-names "$0"' "$DB_NAME"
}

# MySQL string-literal escape: double every single quote.
esc() { printf "%s" "$1" | sed "s/'/''/g"; }

# ---------------------------------------------------------------------------
# 1. Which block?
# ---------------------------------------------------------------------------
BLOCK_ARG="${1:-}"
if [ -z "$BLOCK_ARG" ]; then
  echo "Blocks:"
  db <<<'SELECT id, name FROM blocks WHERE is_active = 1 ORDER BY sort_order, name;' \
    | while IFS=$'\t' read -r id name; do printf '  %s) %s\n' "$id" "$name"; done
  read -rp "Block (id or name): " BLOCK_ARG
fi

if [[ "$BLOCK_ARG" =~ ^[0-9]+$ ]]; then
  BLOCK_ID="$(db <<<"SELECT id FROM blocks WHERE id = $BLOCK_ARG AND is_active = 1;")"
else
  BLOCK_ID="$(db <<<"SELECT id FROM blocks WHERE name = '$(esc "$BLOCK_ARG")' AND is_active = 1;")"
fi
if [ -z "${BLOCK_ID:-}" ]; then
  echo "No active block matches '$BLOCK_ARG'." >&2
  exit 1
fi
BLOCK_NAME="$(db <<<"SELECT name FROM blocks WHERE id = $BLOCK_ID;")"

# ---------------------------------------------------------------------------
# 2. Zone name
# ---------------------------------------------------------------------------
ZONE_NAME="${2:-}"
if [ -z "$ZONE_NAME" ]; then
  read -rp "New zone name (e.g. ZONE-16): " ZONE_NAME
fi
[ -n "$ZONE_NAME" ] || { echo "Zone name required." >&2; exit 1; }
ZONE_ESC="$(esc "$ZONE_NAME")"

# Next sort_order = one past the block's current max.
ZSORT="$(db <<<"SELECT COALESCE(MAX(sort_order),0)+1 FROM zones WHERE block_id = $BLOCK_ID;")"

# ---------------------------------------------------------------------------
# 3. Gram Panchayats — from args 3.. or read one per line until blank.
# ---------------------------------------------------------------------------
GPS=()
if [ "$#" -ge 3 ]; then
  shift 2
  GPS=("$@")
else
  echo "Gram Panchayats for $ZONE_NAME (one per line, blank line to finish):"
  while true; do
    read -rp "  GP: " gp || break
    [ -n "$gp" ] || break
    GPS+=("$gp")
  done
fi

# ---------------------------------------------------------------------------
# 4. Build and run one transactional statement.
# ---------------------------------------------------------------------------
SQL="START TRANSACTION;
INSERT INTO zones (block_id, name, sort_order) VALUES ($BLOCK_ID, '$ZONE_ESC', $ZSORT)
  ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);
SET @zid := (SELECT id FROM zones WHERE block_id = $BLOCK_ID AND name = '$ZONE_ESC');"

n=0
for gp in "${GPS[@]}"; do
  n=$((n+1))
  SQL+="
INSERT INTO panchayats (block_id, zone_id, name, sort_order)
  VALUES ($BLOCK_ID, @zid, '$(esc "$gp")', $n)
  ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order), block_id = VALUES(block_id);"
done
SQL+="
COMMIT;
SELECT z.id AS zone_id, z.name AS zone,
       (SELECT COUNT(*) FROM panchayats p WHERE p.zone_id = z.id AND p.is_active = 1) AS panchayats
  FROM zones z WHERE z.block_id = $BLOCK_ID AND z.name = '$ZONE_ESC';"

echo "Adding zone '$ZONE_NAME' to block '$BLOCK_NAME' with ${#GPS[@]} panchayat(s)..."
db <<<"$SQL"
echo "Done. The new zone is live in the form immediately."
