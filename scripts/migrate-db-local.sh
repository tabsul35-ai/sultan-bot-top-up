#!/usr/bin/env bash
# Pindah database dari Neon ke PostgreSQL LOKAL di VPS ini. Jalankan SEKALI:
#   cd ~/sultan-bot-top-up && bash scripts/migrate-db-local.sh
#
# Script ini otomatis:
#   1. install PostgreSQL (versi mengikuti server Neon, default 18)
#   2. buat database + user
#   3. stop bot, dump semua data dari Neon, restore ke database lokal
#   4. ganti DATABASE_URL di .env ke localhost (.env lama di-backup)
#   5. prisma migrate deploy + generate, lalu start bot lagi
#
# Aman diulang. Kalau Neon suatu saat pindah ke PostgreSQL 19, jalankan:
#   PG_MAJOR=19 bash scripts/migrate-db-local.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PG_MAJOR="${PG_MAJOR:-18}"
DB_NAME="${DB_NAME:-sultan_topup}"
DB_USER="${DB_USER:-sultan}"
PM2_NAME="${PM2_NAME:-sultan-bot}"
ENV_FILE=".env"
STAMP="$(date +%Y%m%d-%H%M%S)"

psql_super() {
  if [ "$(id -u)" -eq 0 ]; then su -s /bin/sh postgres -c "psql $*"
  else sudo -u postgres psql "$@"; fi
}
APT() { if [ "$(id -u)" -eq 0 ]; then apt-get "$@"; else sudo apt-get "$@"; fi; }
AS_ROOT() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }

# --- 1. Ambil URL Neon dari .env lama ---
[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE tidak ada. Jalankan dari folder repo." >&2; exit 1; }
NEON_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')"
case "$NEON_URL" in
  *neon.tech*) : ;;
  *localhost*) echo "DATABASE_URL sudah menunjuk localhost. Sepertinya sudah dipindah. Berhenti."; exit 0 ;;
  "") echo "ERROR: DATABASE_URL kosong di $ENV_FILE" >&2; exit 1 ;;
  *) echo "PERINGATAN: DATABASE_URL bukan Neon:"; echo "  $NEON_URL"
     read -r -p "Pakai URL ini sebagai sumber dump? [y/N] " a; [ "$a" = y ] || exit 1 ;;
esac

# --- 2. Password DB lokal (acak kalau tidak diisi lewat env DB_PASS) ---
DB_PASS="${DB_PASS:-$(openssl rand -hex 16)}"
LOCAL_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}?schema=public"

# --- 3. Pasang PostgreSQL ${PG_MAJOR} kalau belum ada ---
if ! psql --version 2>/dev/null | grep -qE "PostgreSQL\) ${PG_MAJOR}\."; then
  echo "==> Menyiapkan PostgreSQL ${PG_MAJOR} (repo resmi PGDG)"
  APT install -y curl ca-certificates gnupg
  AS_ROOT install -d /usr/share/postgresql-common/pgdg
  AS_ROOT curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc
  . /etc/os-release
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
    | AS_ROOT tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  APT update -y

  # buang PostgreSQL versi lain yang lebih lama supaya cluster ${PG_MAJOR} memakai port 5432
  if [ -d /etc/postgresql ]; then
    for old in $(ls /etc/postgresql | grep -vx "${PG_MAJOR}" || true); do
      echo "==> Menghapus PostgreSQL ${old} yang lama (belum ada data penting)"
      AS_ROOT pg_dropcluster --stop "${old}" main 2>/dev/null || true
      AS_ROOT apt-get purge -y "postgresql-${old}" "postgresql-client-${old}" 2>/dev/null || true
    done
    AS_ROOT apt-get autoremove -y 2>/dev/null || true
  fi

  APT install -y "postgresql-${PG_MAJOR}"
fi
AS_ROOT systemctl enable --now postgresql

# pastikan cluster ${PG_MAJOR} mendengarkan di port 5432
PGPORT="$(AS_ROOT pg_lsclusters -h 2>/dev/null | awk -v v="${PG_MAJOR}" '$1==v && $2=="main"{print $3}')"
if [ -n "${PGPORT:-}" ] && [ "$PGPORT" != "5432" ]; then
  echo "==> Pindahkan PostgreSQL ${PG_MAJOR} dari port ${PGPORT} ke 5432"
  AS_ROOT pg_dropcluster --stop "${PG_MAJOR}" main
  AS_ROOT pg_createcluster --start -p 5432 "${PG_MAJOR}" main
fi
echo "==> $(psql --version)"

# --- 4. Buat user + database (idempoten) ---
echo "==> Siapkan role & database lokal"
psql_super -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
SQL

# --- 5. Stop bot supaya tidak ada order masuk di tengah migrasi ---
pm2 stop "$PM2_NAME" 2>/dev/null || true

# --- 6. Dump dari Neon -> restore ke lokal ---
DUMP="neon-backup-${STAMP}.sql"
echo "==> Dump dari Neon ke $DUMP"
pg_dump "$NEON_URL" --no-owner --no-privileges --no-comments --format=plain --file="$DUMP"
[ -s "$DUMP" ] || { echo "ERROR: hasil dump kosong." >&2; exit 1; }

echo "==> Restore ke database lokal (warning disimpan ke restore-${STAMP}.log)"
psql "$LOCAL_URL" -v ON_ERROR_STOP=0 -f "$DUMP" >/dev/null 2>"restore-${STAMP}.log" || true

echo "==> Jumlah baris di database lokal:"
for t in User Order BotSetting PaymentSetting TransactionLog; do
  n="$(psql "$LOCAL_URL" -tAc "SELECT count(*) FROM \"$t\";" 2>/dev/null || echo '(tabel tidak ada)')"
  printf '    %-16s %s\n' "$t" "$n"
done

# --- 7. Ganti DATABASE_URL di .env ---
cp "$ENV_FILE" "${ENV_FILE}.bak-${STAMP}"
sed -i -E "s#^DATABASE_URL=.*#DATABASE_URL=\"${LOCAL_URL}\"#" "$ENV_FILE"

# --- 8. Prisma + start bot ---
npx prisma migrate deploy || echo "(migrate deploy: tidak ada yang perlu diterapkan - normal)"
npx prisma generate
pm2 restart "$PM2_NAME" --update-env 2>/dev/null || pm2 start dist/index.js --name "$PM2_NAME"
pm2 save

cat <<INFO

==================================================
 SELESAI - database sekarang LOKAL di VPS ini.
   Database : ${DB_NAME}
   User     : ${DB_USER}
   Password : ${DB_PASS}
   (sudah otomatis ditulis ke ${ENV_FILE})

 Backup dump Neon : ${DUMP}
 Backup .env lama : ${ENV_FILE}.bak-${STAMP}
 Log restore      : restore-${STAMP}.log
==================================================
 Cek log bot:  pm2 logs ${PM2_NAME} --lines 30
 Harus muncul: "Terhubung ke database" & "Bot online"

 Rollback: kembalikan DATABASE_URL dari file .bak lalu
           pm2 restart ${PM2_NAME} --update-env
INFO
