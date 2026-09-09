#!/usr/bin/env bash
# Setup awal VPS (Ubuntu / Debian / AlmaLinux / Rocky) untuk Sultan Top Up Bot.
# Jalankan SEKALI setelah SSH pertama kali:
#   bash scripts/setup-server.sh
set -euo pipefail

SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

if command -v apt-get >/dev/null 2>&1; then
  echo "==> Terdeteksi Debian/Ubuntu"
  $SUDO apt-get update -y
  $SUDO apt-get install -y curl git openssl ca-certificates
  if ! command -v node >/dev/null 2>&1; then
    echo "==> Install Node.js 22"
    curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
    $SUDO apt-get install -y nodejs
  fi
elif command -v dnf >/dev/null 2>&1; then
  echo "==> Terdeteksi RHEL/AlmaLinux/Rocky"
  $SUDO dnf install -y curl git openssl
  if ! command -v node >/dev/null 2>&1; then
    echo "==> Install Node.js 22"
    curl -fsSL https://rpm.nodesource.com/setup_22.x | $SUDO -E bash -
    $SUDO dnf install -y nodejs
  fi
else
  echo "OS tidak dikenali (bukan apt/dnf). Install manual: Node.js 22, git, openssl." >&2
  exit 1
fi

echo "==> Versi terpasang:"
node -v
npm -v
git --version

echo "==> Install pm2"
$SUDO npm install -g pm2

echo
echo "Setup dasar selesai. Lanjut DEPLOY-VPS.md bagian 3b."
