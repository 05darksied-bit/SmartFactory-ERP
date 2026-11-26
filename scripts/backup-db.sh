#!/usr/bin/env bash
set -euo pipefail

# SmartFactory ERP - Safe MySQL Backup Script (stores outside container in ./backups)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_DIR/backups"
mkdir -p "$BACKUP_DIR"

if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"
  set +a
fi

STAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="$BACKUP_DIR/smartfactory_erp_${STAMP}.sql.gz"

echo "[BACKUP] Dumping database '${DB_NAME:-smartfactory_erp}' from Docker service 'db'..."
docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T db \
  mysqldump -u root -p"${MYSQL_ROOT_PASSWORD}" --single-transaction --routines --triggers "${DB_NAME:-smartfactory_erp}" \
  | gzip > "$OUT_FILE"

echo "[BACKUP] Saved: $OUT_FILE"

# Keep last 14 days of backups
find "$BACKUP_DIR" -name "smartfactory_erp_*.sql.gz" -type f -mtime +14 -delete
