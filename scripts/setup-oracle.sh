#!/usr/bin/env bash
# Setup awal server Oracle Cloud (Ubuntu) untuk menjalankan Sultan Top Up Bot.
# Jalankan SEKALI setelah SSH pertama kali ke VM:
#   bash setup-oracle.sh
set -euo pipefail

echo "==> Update sistem"
sudo apt-get update -y
sudo apt-get upgrade -y

echo "==> Install git, openssl, build tools"
sudo apt-get install -y git openssl build-essential curl

if ! command -v node >/dev/null 2>&1; then
  echo "==> Install Node.js 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> Versi terpasang:"
node -v
npm -v
git --version

echo "==> Install pm2 (process manager)"
sudo npm install -g pm2

echo
echo "Setup dasar selesai."
echo "Lanjut ikuti DEPLOY-ORACLE.md bagian D (clone repo, isi .env, jalankan bot)."
