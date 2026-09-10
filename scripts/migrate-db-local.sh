#!/usr/bin/env bash
# Pindah database dari Neon ke PostgreSQL LOKAL di VPS ini. Jalankan SEKALI:
#   cd ~/sultan-bot-top-up && bash scripts/migrate-db-local.sh
#
# Script ini otomatis:
#   1. install PostgreSQL (versi mengikuti server Neon, default 18)
#   2. buat user + database lokal yang bersih
#   3. stop bot, dump semua data dari Neon, restore ke database lokal
#   4. ganti DATABASE_URL di .env ke localhost (.env lama di-backup)
#   5. prisma generate + migrate deploy, lalu start bot lagi
#
# Aman diulang. Kalau database lokal sudah berisi order sungguhan, script
# berhenti demi keamanan; timpa paksa dengan:  FORCE=1 bash scripts/migrate-db-local.sh
# Kalau Neon pindah ke PostgreSQL 19:            PG_MAJOR=19 bash scripts/migrate-db-local.sh
# Sumber Neon bisa dipaksa manual:               NEON_URL='postgresql://...neon.tech/...' bash scripts/migrate-db-local.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PG_MAJOR="${PG_MAJOR:-18}"
DB_NAME="${DB_NAME:-sultan_topup}"
DB_USER="${DB_USER:-sultan}"
PM2_NAME="${PM2_NAME:-sultan-bot}"
ENV_FILE=".env"
STAMP="$(date +%Y%m%d-%H%M%S)"

psql_super() {
  if command -v sudo >/dev/null 2>&1; then sudo -u postgres psql "$@"
  else su -s /bin/sh -c 'exec psql "$@"' postgres -- psql "$@"; fi
}
APT() { if [ "$(id -u)" -eq 0 ]; then apt-get "$@"; else sudo apt-get "$@"; fi; }
AS_ROOT() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }
url_from() { grep -E '^DATABASE_URL=' "$1" 2>/dev/null | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//'; }

# --- 1. Tentukan URL Neon (sumber data) ---
[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE tidak ada. Jalankan dari folder repo." >&2; exit 1; }
NEON_URL="${NEON_URL:-}"
if [ -z "$NEON_URL" ]; then
  cur="$(url_from "$ENV_FILE")"
  case "$cur" in
    *neon.tech*) NEON_URL="$cur" ;;
    *)  # .env sudah localhost (script pernah jalan) - cari di backup .env terbaru
      for f in $(ls -t "${ENV_FILE}".bak-* 2>/dev/null || true); do
        b="$(url_from "$f")"
        case "$b" in *neon.tech*) NEON_URL="$b"; echo "==> URL Neon diambil dari $f" ; break ;; esac
      done ;;
  esac
fi
case "${NEON_URL:-}" in
  *neon.tech*) : ;;
  "") echo "ERROR: tidak menemukan URL Neon di .env maupun backup." >&2
      echo "Jalankan lagi dengan: NEON_URL='postgresql://...neon.tech/...' bash scripts/migrate-db-local.sh" >&2; exit 1 ;;
  *)  echo "PERINGATAN: NEON_URL bukan neon.tech:"; echo "  $NEON_URL"
      read -r -p "Lanjut pakai URL ini sebagai sumber dump? [y/N] " a; [ "$a" = y ] || exit 1 ;;
esac

# --- 2. Alamat database lokal ---
DB_PASS="${DB_PASS:-$(openssl rand -hex 16)}"
PG_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"   # untuk psql (libpq)
PRISMA_URL="${PG_URL}?schema=public"                                    # untuk .env (Prisma)

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

PGPORT="$(AS_ROOT pg_lsclusters -h 2>/dev/null | awk -v v="${PG_MAJOR}" '$1==v && $2=="main"{print $3}')"
if [ -n "${PGPORT:-}" ] && [ "$PGPORT" != "5432" ]; then
  echo "==> Pindahkan PostgreSQL ${PG_MAJOR} dari port ${PGPORT} ke 5432"
  AS_ROOT pg_dropcluster --stop "${PG_MAJOR}" main
  AS_ROOT pg_createcluster --start -p 5432 "${PG_MAJOR}" main
fi
echo "==> $(psql --version)"

# --- 4. Buat / setel ulang role ---
echo "==> Siapkan role lokal '${DB_USER}'"
psql_super -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
SQL

# --- 5. Pengaman: jangan timpa database yang sudah berisi order ---
EXISTING="$(psql "$PG_URL" -tAc 'SELECT count(*) FROM "Order"' 2>/dev/null | tr -d '[:space:]' || true)"
if [ -n "${EXISTING:-}" ] && [ "${EXISTING:-0}" -gt 0 ] && [ "${FORCE:-0}" != "1" ]; then
  echo
  echo "STOP: database '${DB_NAME}' sudah berisi ${EXISTING} order - tidak ditimpa."
  echo "Kalau memang ingin hapus & ambil ulang dari Neon:"
  echo "   FORCE=1 bash scripts/migrate-db-local.sh"
  exit 1
fi

# --- 6. Stop bot + buat ulang database bersih ---
pm2 stop "$PM2_NAME" 2>/dev/null || true
echo "==> Buat ulang database '${DB_NAME}' (bersih)"
psql_super -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${DB_NAME}\" WITH (FORCE);"
psql_super -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${DB_NAME}\" OWNER \"${DB_USER}\";"

# --- 7. Dump dari Neon, restore ke lokal ---
DUMP="neon-backup-${STAMP}.sql"
echo "==> Dump dari Neon ke $DUMP"
pg_dump "$NEON_URL" --no-owner --no-privileges --no-comments --format=plain --file="$DUMP"
[ -s "$DUMP" ] || { echo "ERROR: hasil dump kosong." >&2; exit 1; }

echo "==> Restore ke database lokal (warning -> restore-${STAMP}.log)"
psql "$PG_URL" -v ON_ERROR_STOP=0 -f "$DUMP" >/dev/null 2>"restore-${STAMP}.log"

echo "==> Jumlah baris di database lokal:"
for t in User Order BotSetting PaymentSetting TransactionLog; do
  n="$(psql "$PG_URL" -tAc "SELECT count(*) FROM \"$t\";" 2>/dev/null | tr -d '[:space:]' || true)"
  printf '    %-16s %s\n' "$t" "${n:-(tabel tidak ada)}"
done

# --- 8. Ganti DATABASE_URL di .env ---
cp "$ENV_FILE" "${ENV_FILE}.bak-${STAMP}"
sed -i -E "s#^DATABASE_URL=.*#DATABASE_URL=\"${PRISMA_URL}\"#" "$ENV_FILE"

# --- 9. Prisma + start bot ---
npx prisma generate
npx prisma migrate deploy || echo "(migrate deploy: tidak ada yang perlu diterapkan - normal)"
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
 Cek log bot:  pm2 logs ${PM2_NAME} --lines 30 --nostream
 Harus muncul: "Terhubung ke database" & "Bot online"

 Rollback: kembalikan DATABASE_URL dari file .bak lalu
           pm2 restart ${PM2_NAME} --update-env
INFO
