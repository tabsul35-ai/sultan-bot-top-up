#!/usr/bin/env bash
# Update bot di VPS ke versi terbaru dari GitHub.
#   cd ~/sultan-bot-top-up && bash scripts/update.sh
set -e
cd "$(dirname "$0")/.."

git pull --ff-only
npm ci --no-audit --no-fund
npm run build
npx prisma migrate deploy || echo "(migrate deploy dilewati - jalankan manual bila ada perubahan skema)"
pm2 restart sultan-bot --update-env
pm2 save
echo
echo "Update selesai. Cek: pm2 logs sultan-bot"
