# SmartFactory ERP – Database Backup, Restore & Migration Guide

## 1. Persistent Storage Design
- MySQL data is stored in the Docker named volume **`mysql_data`** (`/var/lib/mysql`).
- Backups are written **outside** the container to `./backups/` (excluded from Git via `.gitignore`).
- **Rule:** Never run `docker compose down -v` in production—the `-v` flag deletes `mysql_data`.

---

## 2. Creating Backups

### On Ubuntu Cloud VPS (Bash)
```bash
cd /opt/smartfactory-erp
bash scripts/backup-db.sh
```
This creates a compressed dump `backups/smartfactory_erp_YYYYMMDD_HHMMSS.sql.gz` using `--single-transaction` and retains backups for 14 days.

**Automate daily backups at 2:00 AM via cron:**
```bash
crontab -e
# Add:
0 2 * * * /bin/bash /opt/smartfactory-erp/scripts/backup-db.sh >> /var/log/sf-backup.log 2>&1
```

### On Windows (PowerShell)
```powershell
cd "c:\Users\DEEPAN\Downloads\SmartFactory-ERP-NIT-Internship-Improved\SmartFactory-ERP"
.\scripts\backup-db.ps1
```

---

## 3. Restoring from Backup
```bash
cd /opt/smartfactory-erp
bash scripts/restore-db.sh backups/smartfactory_erp_20261126_020000.sql.gz
```
After restoring, restart the `app` container so any warm-up queries reflect the restored state:
```bash
docker compose restart app
```

---

## 4. Safe Container Restarts & Image Rebuilds
```bash
# Safe app rebuild without touching MySQL data
docker compose up -d --build app

# Safe full-stack restart
docker compose restart
```
Or use the provided deployment script:
```bash
bash scripts/deploy-vps.sh
```

---

## 5. Applying Future Database Migrations Safely
Never run `database/schema.sql` (which contains `DROP TABLE`) on a live production database. Instead, apply additive SQL migrations:
```bash
# Always back up first!
bash scripts/backup-db.sh

# Apply a migration file safely
docker compose exec -T db mysql -u root -p"$MYSQL_ROOT_PASSWORD" smartfactory_erp < database/migrations/001_erp_audit_improvements.sql
docker compose exec -T db mysql -u root -p"$MYSQL_ROOT_PASSWORD" smartfactory_erp < database/migrations/002_masters_upgrade.sql
docker compose exec -T db mysql -u root -p"$MYSQL_ROOT_PASSWORD" smartfactory_erp < database/migrations/003_stretch_goals.sql
```
