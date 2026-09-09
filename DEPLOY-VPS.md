# Deploy 24/7 ke VPS (RumahWeb / VPS Ubuntu/Debian/AlmaLinux mana pun)

Bot jalan di VPS dengan **pm2** (auto-restart + tahan reboot). Database tetap **Neon**.

```
Push kode ke GitHub  →  Beli VPS  →  SSH masuk  →  bash scripts/setup-server.sh
   →  clone repo + isi .env + build + migrate  →  pm2 start / save / startup
   →  matikan bot lokal
```

---

## 0. Push kode ke GitHub (WAJIB dulu)

Di terminal PC, di folder project:

```bash
cd "C:\Users\USER\Downloads\sultan-topup-bot\sultan-topup-bot"
git push -u origin main
```

Popup login browser → authorize. Lalu set repo **Public**
(halaman repo GitHub → Settings → Change repository visibility → Public).

> `.env` tidak ikut ter-push. Dibuat manual di server nanti.

---

## 1. Beli VPS

- **Paket:** S sudah cukup (bot ini < 250 MB RAM). M lebih lega.
- **OS:** **Ubuntu 22.04** atau **Debian 12** (disarankan). AlmaLinux juga didukung script. **Hindari CloudLinux.**
- **Control Panel:** Tanpa Control Panel
- Bayar → tunggu email berisi: **IP VPS**, **username** (biasanya `root`), **password**.

---

## 2. Masuk SSH

**Windows PowerShell:**
```powershell
ssh root@IP_VPS
```
- Ketik `yes` saat ditanya fingerprint.
- Masukkan password dari email (saat mengetik password tidak kelihatan — normal).
- Kalau diminta ganti password saat login pertama, buat password baru yang kuat & catat.

Kalau sudah masuk, prompt jadi seperti `root@vps:~#`.

---

## 3. Setup server + deploy bot

Semua perintah berikut dijalankan **di dalam SSH VPS**.

### 3a. Ambil kode + install Node/pm2

```bash
cd ~
git clone https://github.com/tabsul35-ai/sultan-bot-top-up.git
cd sultan-bot-top-up
bash scripts/setup-server.sh
```

Tunggu sampai muncul "Setup dasar selesai", lalu:

```bash
npm ci
```

### 3b. Buat file `.env`

Jalankan blok ini — ganti nilai dalam tanda kutip dengan milik Anda (dari `.env` di PC):

```bash
cat > .env <<'EOF'
DISCORD_TOKEN=ISI_TOKEN_DISINI
DISCORD_CLIENT_ID=1547303623380176997
DISCORD_GUILD_ID=1443954404406595654
DATABASE_URL=ISI_DATABASE_URL_NEON_DISINI
EOF
```

Cek:
```bash
cat .env
```

### 3c. Build + siapkan database

```bash
npm run build
npx prisma migrate deploy
```

`migrate deploy` cuma menambah tabel yang belum ada — data Neon tidak dihapus.

### 3d. Jalankan dengan pm2

```bash
pm2 start dist/index.js --name sultan-bot
pm2 logs sultan-bot --lines 30
```

Cari:
```
✅ Terhubung ke database.
👑 Sultan Top Up Bot online sebagai sultan topup#0749
✅ 9 slash command didaftarkan ke guild ...
```
`Ctrl+C` untuk keluar dari log (bot tetap jalan).

### 3e. Biar tahan reboot VPS

```bash
pm2 save
pm2 startup
```

`pm2 startup` mencetak **satu perintah** panjang (diawali `sudo env PATH=...` atau `env PATH=...`).
**Copy, paste, jalankan.** Lalu:
```bash
pm2 save
```

---

## 4. Matikan bot lokal

Di PC, jendela `npm run dev` → **Ctrl + C**.
Jangan biarkan bot PC & bot VPS jalan bareng (balas dobel).

---

## Update bot ke depannya

Di PC:
```bash
git add . && git commit -m "update" && git push
```

Di SSH VPS:
```bash
cd ~/sultan-bot-top-up
git pull
npm ci
npm run build
npx prisma migrate deploy    # hanya kalau ada migration baru
pm2 restart sultan-bot
```

---

## Perintah pm2

| Perintah | Fungsi |
|---|---|
| `pm2 logs sultan-bot` | Log real-time |
| `pm2 restart sultan-bot` | Restart |
| `pm2 stop sultan-bot` | Stop |
| `pm2 status` | Status |
| `pm2 monit` | Monitor CPU/RAM |

---

## Troubleshooting

| Gejala | Solusi |
|---|---|
| `git clone` minta username/password | Repo masih Private. Jadikan **Public**, atau `git clone https://TOKEN@github.com/...` pakai Personal Access Token GitHub. |
| `bash: scripts/setup-server.sh: No such file` | Belum `cd sultan-bot-top-up`. |
| `prisma migrate deploy` → `Can't reach database server` | `DATABASE_URL` di `.env` salah/kurang. Samakan persis dengan `.env` di PC (termasuk `?sslmode=require...`). |
| Bot jalan, command Discord tak muncul | Tunggu 1 menit; cek `pm2 logs` ada baris "slash command didaftarkan". |
| Bot mati setelah reboot VPS | Perintah dari `pm2 startup` belum dijalankan, atau `pm2 save` belum. |
| Balas dobel | Bot lokal / bot lama belum dimatikan. |
