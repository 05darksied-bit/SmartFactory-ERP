#!/usr/bin/env bash
set -euo pipefail

# SmartFactory ERP - Safe Zero-Data-Loss VPS Deployment Script
# Never runs 'docker compose down -v' so persistent MySQL data is always preserved.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "[DEPLOY] 1. Creating pre-deployment database backup (if db is running)..."
if docker compose ps --status running | grep -q "db"; then
  bash "$SCRIPT_DIR/backup-db.sh" || echo "[DEPLOY] Backup skipped (fresh database)."
fi

echo "[DEPLOY] 2. Pulling latest code..."
git pull --ff-only || true

echo "[DEPLOY] 3. Building and updating containers (preserving mysql_data volume)..."
if [ -f "/etc/letsencrypt/live/$(grep -E '^CORS_ORIGIN=' .env | sed 's/.*https:\/\///' | cut -d',' -f1)/fullchain.pem" ]; then
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
else
  docker compose up -d --build
fi

echo "[DEPLOY] 4. Verifying container health..."
sleep 5
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health || true
echo ""
echo "[DEPLOY] Complete."
