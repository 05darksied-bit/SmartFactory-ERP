#!/usr/bin/env bash
set -euo pipefail

# SmartFactory ERP - Safe MySQL Restore Script
if [ $# -lt 1 ]; then
  echo "Usage: $0 <path-to-backup.sql.gz|backup.sql>"
  exit 1
fi

BACKUP_FILE="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file not found: $BACKUP_FILE"
  exit 1
fi

if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"
  set +a
fi

echo "[RESTORE] Restoring '$BACKUP_FILE' into '${DB_NAME:-smartfactory_erp}'..."
if [[ "$BACKUP_FILE" == *.gz ]]; then
  gunzip -c "$BACKUP_FILE" | docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T db \
    mysql -u root -p"${MYSQL_ROOT_PASSWORD}" "${DB_NAME:-smartfactory_erp}"
else
  cat "$BACKUP_FILE" | docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T db \
    mysql -u root -p"${MYSQL_ROOT_PASSWORD}" "${DB_NAME:-smartfactory_erp}"
fi
echo "[RESTORE] Complete."
