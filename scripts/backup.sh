#!/usr/bin/env bash
# Nightly backup: database dump + uploaded files, 14-day retention.
#
# Install with:
#   crontab -e
#   15 2 * * *  /path/to/LRT_PANCHAYAT/scripts/backup.sh >> /var/log/lrt-backup.log 2>&1

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
set -a; [ -f .env ] && . ./.env; set +a

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$ROOT/backups"
mkdir -p "$DEST"

echo "[$(date -Is)] backing up database..."
docker compose exec -T db \
  mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines "$DB_NAME" \
  | gzip > "$DEST/db-$STAMP.sql.gz"

echo "[$(date -Is)] backing up uploads..."
tar czf "$DEST/uploads-$STAMP.tar.gz" -C "$ROOT/data" uploads

echo "[$(date -Is)] pruning backups older than 14 days..."
find "$DEST" -name '*.gz' -mtime +14 -delete

echo "[$(date -Is)] done. Current backups:"
ls -lh "$DEST" | tail -5
