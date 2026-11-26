#!/usr/bin/env bash
# =============================================================
# SmartFactory ERP – Let's Encrypt SSL setup (OCI)
# Run AFTER oci-bootstrap.sh once you have a domain pointing
# to the OCI public IP.
# Usage: bash scripts/certbot-ssl.sh your-domain.com
# =============================================================
set -euo pipefail
DOMAIN="${1:?Usage: $0 your-domain.com}"
EMAIL="${2:-admin@${DOMAIN}}"

echo "=== Installing certbot ==="
sudo apt-get install -y certbot

echo "=== Obtaining Let's Encrypt certificate for ${DOMAIN} ==="
# Use standalone challenge (stops Nginx temporarily)
docker compose -f docker-compose.yml -f docker-compose.oci.yml stop nginx 2>/dev/null || true
sudo certbot certonly --standalone \
  -d "${DOMAIN}" \
  --non-interactive \
  --agree-tos \
  -m "${EMAIL}"

echo "=== Switching Nginx to HTTPS config ==="
# Replace the IP-only Nginx conf with the domain+SSL conf
sed "s/your-domain.com/${DOMAIN}/g" nginx/smartfactory.conf > /tmp/sf-ssl.conf
sudo cp /tmp/sf-ssl.conf nginx/smartfactory-domain.conf

# Restart with full prod compose (port 80+443, SSL)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

echo "=== Setting up auto-renewal cron ==="
(crontab -l 2>/dev/null; echo "0 3 * * * /usr/bin/certbot renew --quiet --deploy-hook 'docker compose -f /opt/smartfactory/docker-compose.yml -f /opt/smartfactory/docker-compose.prod.yml restart nginx'") | crontab -

echo "============================================================"
echo " HTTPS is now LIVE at: https://${DOMAIN}"
echo "============================================================"
