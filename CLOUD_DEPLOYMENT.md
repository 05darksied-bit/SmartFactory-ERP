# SmartFactory ERP – Public Cloud VPS Deployment Guide (Ubuntu + HTTPS)

This guide takes you from a Windows laptop to a **public HTTPS URL** on an Ubuntu Cloud VPS (so the NIT Tiruchirappalli evaluator can access your ERP even when your laptop is switched off).

---

## 1. Select a Cloud VPS
Choose any provider offering Ubuntu 22.04 or 24.04 LTS (1–2 vCPU, 2 GB RAM, 25+ GB SSD):
- DigitalOcean Droplet, AWS Lightsail / EC2, Vultr, Linode, or Hetzner Cloud.
- **Open inbound ports** in your cloud provider's security group / firewall: `22` (SSH), `80` (HTTP), `443` (HTTPS). **Do NOT open port `3306` or `3000` publicly.**

## 2. Create an Ubuntu Server
- OS: **Ubuntu 24.04 LTS** (or 22.04 LTS).
- Authentication: SSH key pair (recommended) or root password.
- Note your server's **Public IPv4 Address** (e.g., `203.0.113.10`).

## 3. Connect from Windows Using SSH (PowerShell)
```powershell
ssh root@203.0.113.10
```
*(Or `ssh -i C:\path\to\key.pem ubuntu@203.0.113.10` on AWS.)*

## 4. Install Docker & Docker Compose on Ubuntu
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg ufw git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker --version && docker compose version
```

## 5. Clone the Project on the VPS
```bash
sudo mkdir -p /opt/smartfactory-erp
sudo chown $USER:$USER /opt/smartfactory-erp
git clone https://github.com/<YOUR_USERNAME>/<YOUR_REPO>.git /opt/smartfactory-erp
cd /opt/smartfactory-erp
```

## 6. Configure Production Environment Variables
```bash
cp .env.production.example .env
# Generate a strong JWT secret:
openssl rand -hex 32
nano .env
```
In `.env`, set:
- `NODE_ENV=production`
- `DB_HOST=db`
- `DB_PORT=3306`
- `DB_NAME=smartfactory_erp`
- `DB_USER=smartfactory_app`
- `DB_PASSWORD=<strong-random-password>`
- `MYSQL_ROOT_PASSWORD=<strong-root-password>`
- `JWT_SECRET=<output-of-openssl-rand-hex-32>`
- `CORS_ORIGIN=https://your-domain.com`

Protect `.env` permissions:
```bash
chmod 600 .env
```

## 7. Build and Start Containers
```bash
docker compose up --build -d
docker compose ps
```
Wait until `db` and `app` both show **`healthy`**.

## 8. Import Existing Database Safely (or Seed Benchmark)
**Option A — Import your local MySQL dump (preserves all your local data):**
From **Windows PowerShell**:
```powershell
mysqldump -u root -p smartfactory_erp --single-transaction --routines --triggers > smartfactory_backup.sql
scp smartfactory_backup.sql root@203.0.113.10:/opt/smartfactory-erp/
```
Then on the **Ubuntu VPS**:
```bash
cd /opt/smartfactory-erp
bash scripts/restore-db.sh smartfactory_backup.sql
```

**Option B — Fresh NIT benchmark seed (only on an empty database):**
```bash
docker compose exec app npm run seed
```

## 9. Configure Ubuntu Firewall (UFW)
```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

## 10. Configure Your Domain (DNS)
In your domain registrar (Namecheap, Cloudflare, GoDaddy, etc.), add an **A record**:
- Host: `@` (and optionally `www`) → Value: `<YOUR_VPS_PUBLIC_IP>`
- Wait 1–5 minutes and verify with `nslookup your-domain.com`.

*(If you don't have a custom domain, you can use a free subdomain service like DuckDNS pointing to your VPS IP so Let's Encrypt can issue a valid HTTPS certificate.)*

## 11. Enable HTTPS with Let's Encrypt & Nginx
1. Update `nginx/smartfactory.conf` replacing `your-domain.com` with your actual domain:
   ```bash
   sed -i 's/your-domain.com/YOUR_ACTUAL_DOMAIN/g' nginx/smartfactory.conf
   ```
2. Install Certbot and obtain the SSL certificate:
   ```bash
   sudo apt install -y certbot
   sudo certbot certonly --standalone -d YOUR_ACTUAL_DOMAIN
   ```
3. Start the full production stack with Nginx:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```
4. Set up automatic certificate renewal:
   ```bash
   sudo crontab -e
   # Add: 0 3 * * * certbot renew --quiet --pre-hook "docker compose -f /opt/smartfactory-erp/docker-compose.yml -f /opt/smartfactory-erp/docker-compose.prod.yml stop nginx" --post-hook "docker compose -f /opt/smartfactory-erp/docker-compose.yml -f /opt/smartfactory-erp/docker-compose.prod.yml start nginx"
   ```

## 12. Verify the Public Application
```bash
curl -fsS https://YOUR_ACTUAL_DOMAIN/api/health
```
Open `https://YOUR_ACTUAL_DOMAIN` in a browser from another computer/phone and verify:
- Login works for all roles (`OWNER`, `ADMIN`, `SALESMAN`, `PRODUCTION`, `ACCOUNTANT`).
- Orders, Production BOM, Inventory, GST Invoices, Payments, and Reports load and persist across `docker compose restart`.

---

## Troubleshooting Cloud Deployment
- **Nginx 502 Bad Gateway:** Run `docker compose logs app` and verify `app` is `healthy` on `smartfactory_net`.
- **Certbot fails on port 80:** Ensure `ufw` and cloud firewall allow port `80` and no other web server (`apache2`/system `nginx`) is running (`sudo systemctl stop nginx`).
- **CORS error in browser:** Ensure `CORS_ORIGIN` in `.env` matches `https://YOUR_ACTUAL_DOMAIN` exactly (or leave blank for same-origin).
- **Database connection refused:** Confirm `DB_HOST=db` in `.env` and `docker compose ps` shows `db` is `healthy`.
