# Deploy 24/7 di VPS (RumahWeb)

Bot **dan** database jalan di satu VPS RumahWeb. Bot pakai **pm2** (auto-restart + tahan reboot),
database pakai **PostgreSQL lokal** di VPS yang sama (bukan Neon lagi).

## Kondisi sekarang

| Item | Nilai |
|---|---|
| VPS | Ubuntu 22.04, IP `203.194.112.105` |
| Folder bot | `~/sultan-bot-top-up` |
| Proses pm2 | `sultan-bot` |
| Database | PostgreSQL 18 lokal — `postgresql://sultan:***@localhost:5432/sultan_topup` |
| `.env` | hanya ada di VPS (tidak ikut Git). Password DB ada di baris `DATABASE_URL`. |

Migrasi dari Neon dilakukan dengan [scripts/migrate-db-local.sh](scripts/migrate-db-local.sh) (dump dari Neon → restore ke DB lokal).

---

## Update bot ke versi terbaru (tugas paling sering)

**Di PC:**
```bash
git add . && git commit -m "update" && git push
```

**Di SSH VPS:**
```bash
cd ~/sultan-bot-top-up
bash scripts/update.sh
```

`scripts/update.sh` menjalankan: `git pull` → `npm ci` → `npm run build` →
`npx prisma migrate deploy` (kalau ada migration baru) → `pm2 restart sultan-bot` → `pm2 save`.

Cek hasil:
```bash
pm2 logs sultan-bot --lines 30 --nostream
```
Harus ada `✅ Terhubung ke database.` dan `👑 ... online` tanpa error merah.

---

## Backup database

Database sekarang di VPS sendiri — **tidak ada backup otomatis** seperti Neon. Backup manual:

```bash
cd ~/sultan-bot-top-up
pg_dump "postgresql://sultan:PASSWORD@localhost:5432/sultan_topup" \
  --no-owner --no-privileges -Fc -f "backup-$(date +%F).dump"
```
(ganti `PASSWORD` — lihat `grep DATABASE_URL .env`).

Restore ke database kosong:
```bash
pg_restore --no-owner --no-privileges -d "postgresql://sultan:PASSWORD@localhost:5432/sultan_topup" backup-YYYY-MM-DD.dump
```

Untuk backup harian otomatis (cron), minta dibuatkan script terpisah.

---

## Perintah pm2

| Perintah | Fungsi |
|---|---|
| `pm2 logs sultan-bot` | Log real-time (`Ctrl+C` keluar, bot tetap jalan) |
| `pm2 logs sultan-bot --lines 30 --nostream` | 30 baris log terakhir lalu keluar |
| `pm2 restart sultan-bot` | Restart |
| `pm2 stop sultan-bot` | Stop |
| `pm2 status` | Status |
| `pm2 flush sultan-bot` | Kosongkan file log |

---

## Perintah PostgreSQL

| Perintah | Fungsi |
|---|---|
| `systemctl status postgresql` | Cek service database hidup |
| `systemctl restart postgresql` | Restart database |
| `sudo -u postgres psql -d sultan_topup` | Masuk konsol SQL (`\dt` lihat tabel, `\q` keluar) |
| `sudo -u postgres psql -d sultan_topup -c 'SELECT count(*) FROM "Order";'` | Hitung order |

---

## Troubleshooting

| Gejala | Solusi |
|---|---|
| Bot log: `password authentication failed for user "sultan"` | Password di `.env` tidak cocok dengan role DB. Setel ulang: `sudo -u postgres psql -c "ALTER ROLE sultan PASSWORD 'PASSWORD_BARU';"` lalu samakan di `.env` (`DATABASE_URL`), `pm2 restart sultan-bot --update-env`. |
| Bot log: `P1001` / `Can't reach database server at localhost:5432` | PostgreSQL mati. `systemctl restart postgresql`, cek `systemctl status postgresql`. |
| `pg_dump: server version mismatch` saat migrasi dari Neon | Versi PostgreSQL VPS lebih tua dari Neon. `scripts/migrate-db-local.sh` sudah memasang versi yang cocok (default 18); untuk versi lain: `PG_MAJOR=19 bash scripts/migrate-db-local.sh`. |
| Bot jalan, command Discord tak muncul | Tunggu 1 menit; cek `pm2 logs` ada baris "slash command didaftarkan". |
| Bot mati setelah reboot VPS | Perintah dari `pm2 startup` belum dijalankan, atau `pm2 save` belum. Jalankan `pm2 save` lalu `pm2 startup` (ikuti perintah yang dicetak). |
| Balas dobel | Bot lokal (`npm run dev` di PC) masih jalan. Matikan dengan `Ctrl+C`. |

---

## Lampiran — pasang ulang dari nol (kalau VPS dibangun ulang)

Hanya perlu kalau VPS di-reset total.

### 1. Node + pm2
```bash
cd ~
git clone https://github.com/tabsul35-ai/sultan-bot-top-up.git
cd sultan-bot-top-up
bash scripts/setup-server.sh
npm ci
```

### 2. Buat `.env` (sementara pakai Neon kalau masih ada, atau isi DATABASE_URL lokal langsung)
```bash
cat > .env <<'EOF'
DISCORD_TOKEN=ISI_TOKEN
DISCORD_CLIENT_ID=1547303623380176997
DISCORD_GUILD_ID=1443954404406595654
DATABASE_URL=postgresql://sultan:PASSWORD@localhost:5432/sultan_topup?schema=public
EOF
```

### 3. Database lokal + build
- Kalau ada backup `.dump`: pasang PostgreSQL, buat role+db, `pg_restore` (lihat bagian Backup).
- Kalau masih ada data di Neon: isi `DATABASE_URL` Neon dulu di `.env`, lalu `bash scripts/migrate-db-local.sh`.

```bash
npm run build
npx prisma migrate deploy
```

### 4. pm2
```bash
pm2 start dist/index.js --name sultan-bot
pm2 save
pm2 startup   # jalankan perintah yang dicetak, lalu: pm2 save
```
