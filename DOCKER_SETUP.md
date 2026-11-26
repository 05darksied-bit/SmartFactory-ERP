# SmartFactory ERP – Local & Production Docker Setup Guide

## 1. Architecture Overview

```text
Internet → HTTPS (443) → Nginx Reverse Proxy (docker-compose.prod.yml)
                              │
                              ▼
                        Node.js / Express (app:3000)
                              │  (internal bridge network: smartfactory_net)
                              ▼
                        MySQL 8.0 (db:3306) ← Named Volume: mysql_data
```

- **MySQL (`db`)** is **never** exposed to the host or public internet (`smartfactory_net` only).
- **Express (`app`)** listens on `0.0.0.0:3000`, bound to `127.0.0.1:3000` locally for safe testing and proxied by Nginx in production.
- **Database initialization** (`database/init/01-schema.sql`) uses `CREATE TABLE IF NOT EXISTS` and runs only when `mysql_data` is brand new.

---

## 2. Prerequisites (Windows)

1. Install **Docker Desktop for Windows** and ensure **Engine running** appears in the bottom-left corner.
2. Stop any local `node backend/app.js` process using port `3000`.

---

## 3. Configure Environment Variables (Windows PowerShell)

```powershell
cd "c:\Users\DEEPAN\Downloads\SmartFactory-ERP-NIT-Internship-Improved\SmartFactory-ERP"
Copy-Item .env.production.example .env
```

Edit `.env` and set strong values for:
- `JWT_SECRET` (64+ random hex characters)
- `DB_USER=smartfactory_app`
- `DB_PASSWORD` (strong password for the least-privilege app user)
- `MYSQL_ROOT_PASSWORD` (strong root password)
- `CORS_ORIGIN=http://localhost:3000` (for local Docker testing)

> [!CAUTION]
> Keep your local MySQL `.env` backed up if you switch between local MySQL (`DB_HOST=localhost`) and Docker MySQL (`DB_HOST=db`).

---

## 4. Build and Start Docker Containers (PowerShell)

```powershell
# Validate compose configuration
docker compose config

# Build and start MySQL + Express in detached mode
docker compose up --build -d

# Check container health
docker compose ps
```

Wait until both `db` and `app` show **`healthy`**.

---

## 5. Seed Initial Benchmark Data (First-Time Setup Only)

> [!WARNING]
> Only run `npm run seed` on a brand-new demo database. It truncates existing transaction tables and loads the NIT Tiruchirappalli benchmark dataset.

```powershell
docker compose exec app npm run seed
```

---

## 6. Verify Locally

1. Check API health:
   ```powershell
   Invoke-RestMethod http://localhost:3000/api/health
   ```
   Expected output: `status: ok`, `db: connected`.
2. Open **http://localhost:3000** in your browser and test all 6 demo accounts (`ChangeMe123!`).

---

## 7. Safe Restart & Shutdown Commands

```powershell
# Restart application only (preserves database)
docker compose restart app

# Stop containers (preserves mysql_data volume)
docker compose down

# NEVER run `docker compose down -v` in production — `-v` deletes the MySQL volume!
```

---

## 8. Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| `open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified` | Docker Desktop is not running | Open Docker Desktop and wait for "Engine running" |
| `Bind for 127.0.0.1:3000 failed: port is already allocated` | Local Node.js process is using port 3000 | Stop the local Node server or change `PORT=3001` in `.env` |
| `app` fails with `Access denied for user` | `mysql_data` was previously initialized with a different password | Use matching `DB_PASSWORD` / `MYSQL_ROOT_PASSWORD` in `.env` |
| `db` unhealthy on startup | MySQL takes 15–30s on first volume init | Wait and run `docker compose logs db` |
| `JWT_SECRET is not securely configured` | Default placeholder left in `.env` under `NODE_ENV=production` | Set a unique 64-char random `JWT_SECRET` in `.env` |
