#!/usr/bin/env bash
# =============================================================
# SmartFactory ERP – Oracle Cloud OCI Bootstrap Script
# Run once as ubuntu user after SSH into the OCI instance.
# =============================================================
set -euo pipefail

echo "=== [1/6] System update ==="
sudo apt-get update -y && sudo apt-get upgrade -y

echo "=== [2/6] Install Docker Engine ==="
sudo apt-get install -y ca-certificates curl gnupg lsb-release
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu
sudo systemctl enable docker
sudo systemctl start docker
docker --version; docker compose version

echo "=== [3/6] Open OCI host firewall (iptables) ==="
# OCI Ubuntu images use iptables DROP by default; open 22, 80, 443
sudo iptables -I INPUT 1 -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 22  -j ACCEPT
sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save

echo "=== [4/6] Clone SmartFactory ERP ==="
if [ -d "/opt/smartfactory" ]; then
  cd /opt/smartfactory && git pull --ff-only
else
  sudo git clone https://github.com/05darksied-bit/SmartFactory-ERP.git /opt/smartfactory
  sudo chown -R ubuntu:ubuntu /opt/smartfactory
fi
cd /opt/smartfactory

echo "=== [5/6] Create .env file ==="
if [ ! -f ".env" ]; then
  cp .env.production.example .env
  # Generate a random 64-char JWT secret
  JWT=$(openssl rand -hex 32)
  ROOT_PW=$(openssl rand -hex 16)
  APP_PW=$(openssl rand -hex 16)
  sed -i "s|CHANGE_ME_TO_64_CHAR_RANDOM_HEX_SECRET|${JWT}|g" .env
  sed -i "s|CHANGE_ME_TO_STRONG_ROOT_PASSWORD|${ROOT_PW}|g" .env
  sed -i "s|CHANGE_ME_TO_STRONG_APP_PASSWORD|${APP_PW}|g" .env
  echo "CORS_ORIGIN=http://$(curl -s ifconfig.me)" >> .env
  echo ""
  echo ">>> .env created with random secrets. Keep it safe — never commit it!"
  echo ">>> Public IP added to CORS_ORIGIN."
else
  echo ">>> .env already exists, skipping."
fi

echo "=== [6/6] Start SmartFactory ERP with Nginx (HTTP only) ==="
docker compose -f docker-compose.yml -f docker-compose.oci.yml up -d --build
sleep 8
docker compose ps
PUBLIC_IP=$(curl -s ifconfig.me)
echo ""
echo "============================================================"
echo " SmartFactory ERP is now LIVE at:"
echo "   http://${PUBLIC_IP}"
echo " Health check:"
curl -s http://127.0.0.1:3000/api/health || true
echo ""
echo " Next: add domain + run scripts/certbot-ssl.sh for HTTPS"
echo "============================================================"
