# Deploy 24/7 GRATIS ke Oracle Cloud (Always Free)

Bot jalan di VPS Linux gratis permanen milik Oracle. Database tetap **Neon** (tidak diubah).

Ringkas alurnya:
```
Push kode ke GitHub  →  Daftar Oracle  →  Buat VM (Always Free)  →  SSH ke VM
   →  jalankan setup-oracle.sh  →  clone repo + isi .env + build + migrate
   →  pm2 start + pm2 save + pm2 startup  →  cek log  →  matikan bot lokal
```

---

## 0. Push kode ke GitHub (WAJIB dulu — VM akan `git clone` dari sini)

Di terminal Anda, di folder project:

```bash
cd "C:\Users\USER\Downloads\sultan-topup-bot\sultan-topup-bot"
git push -u origin main
```

Muncul popup **"Sign in with your browser"** → authorize. Setelah selesai, buka
`https://github.com/tabsul35-ai/sultan-bot-top-up` — file harus sudah muncul di sana.

**Set repo jadi Public** (paling gampang): halaman repo → **Settings** → paling bawah
**Change repository visibility** → **Public**. Aman — tidak ada rahasia di kode
(token ada di `.env` yang tidak ikut ter-push).
Kalau tetap mau Private, lihat Troubleshooting soal Personal Access Token.

> `.env` TIDAK ikut ter-push (diblokir `.gitignore`). Nanti dibuat manual di server.

---

## 1. Daftar Oracle Cloud

1. Buka https://www.oracle.com/cloud/free/ → **Start for free**
2. Isi data, pilih **Country/Territory: Indonesia**
3. Verifikasi email + nomor HP
4. Masukkan **kartu** (debit/kredit/virtual) — hanya untuk verifikasi identitas, **tidak ditagih** selama pakai Always Free
5. Pilih **Home Region**: `Singapore` atau `Jakarta` (paling dekat; region tidak bisa diganti nanti)
6. Tunggu akun aktif (kadang beberapa menit, kadang beberapa jam)

> Kalau pendaftaran ditolak/limbo: coba kartu lain (virtual card sering berhasil), atau ulangi keesokan harinya.

---

## 2. Buat VM (instance) Always Free

1. Login ke https://cloud.oracle.com
2. Menu ☰ → **Compute** → **Instances** → **Create instance**
3. **Name**: `sultan-bot`
4. **Image and shape** → **Edit**:
   - Image: **Canonical Ubuntu 22.04** (atau 24.04)
   - Shape: **Change shape** → tab **Ampere** → `VM.Standard.A1.Flex` → 1 OCPU / 6 GB
     - Kalau muncul **"Out of capacity"**: pakai tab **Specialty and previous generation** → `VM.Standard.E2.1.Micro` (1 OCPU / 1 GB). Ini juga Always Free dan lebih gampang dapat.
   - Pastikan ada tulisan **"Always Free-eligible"**
5. **Networking**: biarkan default (buat VCN baru). Bot tidak butuh port masuk apa pun.
6. **Add SSH keys**:
   - Pilih **Generate a key pair for me** → **Download private key** (simpan file `.key`, JANGAN hilang) dan **Download public key**
   - (Kalau sudah paham SSH, boleh paste public key sendiri)
7. **Create**. Tunggu status jadi **Running**, catat **Public IP address**.

---

## 3. SSH ke VM

**Cara termudah — Oracle Cloud Shell** (tidak perlu ngoprek SSH di Windows):

1. Di halaman instance, klik ikon **Cloud Shell** (pojok kanan atas, ikon `>_`)
2. Upload private key: menu Cloud Shell → **Upload** → pilih file `.key` tadi
3. Di Cloud Shell:
   ```bash
   chmod 600 nama-file.key
   ssh -i nama-file.key ubuntu@PUBLIC_IP
   ```
   (ganti `nama-file.key` dan `PUBLIC_IP`)
4. Ketik `yes` saat ditanya fingerprint.

**Atau dari PowerShell Windows:**
```powershell
ssh -i "C:\path\ke\nama-file.key" ubuntu@PUBLIC_IP
```

Kalau sudah masuk, prompt berubah jadi `ubuntu@sultan-bot:~$`.

---

## 4. Setup server + deploy bot

Semua perintah di bawah dijalankan **di dalam SSH VM**.

### 4a. Ambil kode

```bash
cd ~
sudo apt-get update -y && sudo apt-get install -y git
git clone https://github.com/tabsul35-ai/sultan-bot-top-up.git
cd sultan-bot-top-up
```

### 4b. Install Node & pm2

```bash
bash scripts/setup-oracle.sh
```

Tunggu sampai muncul "Setup dasar selesai", lalu:

```bash
npm ci
```

### 4c. Buat file `.env`

Jalankan blok ini, ganti nilai di dalam tanda kutip dengan milik Anda (dari `.env` lokal):

```bash
cat > .env <<'EOF'
DISCORD_TOKEN=ISI_TOKEN_DISINI
DISCORD_CLIENT_ID=1547303623380176997
DISCORD_GUILD_ID=1443954404406595654
DATABASE_URL=ISI_DATABASE_URL_NEON_DISINI
EOF
```

Cek isinya benar:
```bash
cat .env
```

### 4d. Build + siapkan database

```bash
npm run build
npx prisma migrate deploy
```

`migrate deploy` cuma menyamakan tabel yang belum ada (aman, data Neon tidak dihapus).

### 4e. Jalankan dengan pm2

```bash
pm2 start dist/index.js --name sultan-bot
pm2 logs sultan-bot --lines 30
```

Cari baris:
```
✅ Terhubung ke database.
👑 Sultan Top Up Bot online sebagai sultan topup#0749
✅ 9 slash command didaftarkan ke guild ...
```

Tekan `Ctrl+C` untuk keluar dari tampilan log (bot tetap jalan).

### 4f. Biar tahan reboot

```bash
pm2 save
pm2 startup
```

`pm2 startup` akan **mencetak satu perintah** yang diawali `sudo env PATH=...`.
**Copy perintah itu, paste, jalankan.** Lalu `pm2 save` sekali lagi.

---

## 5. Matikan bot lokal

Di PC Anda, jendela `npm run dev` → **Ctrl + C**.
Jangan sampai bot lokal & bot VM jalan bersamaan (balas dobel).

---

## Update bot ke depannya

Di PC:
```bash
git add . && git commit -m "update" && git push
```

Di SSH VM:
```bash
cd ~/sultan-bot-top-up
git pull
npm ci
npm run build
npx prisma migrate deploy   # hanya kalau ada migration baru
pm2 restart sultan-bot
```

Slash command otomatis terdaftar ulang tiap restart.

---

## Perintah pm2 yang berguna

| Perintah | Fungsi |
|---|---|
| `pm2 logs sultan-bot` | Lihat log real-time |
| `pm2 restart sultan-bot` | Restart bot |
| `pm2 stop sultan-bot` | Stop bot |
| `pm2 status` | Lihat status semua proses |
| `pm2 monit` | Monitor CPU/RAM |

---

## Troubleshooting

| Gejala | Sebab & solusi |
|---|---|
| `git clone` minta password | Repo masih Private & belum login. Buat repo **Public**, atau `git clone https://TOKEN@github.com/...` pakai Personal Access Token. |
| `npm ci` error `EBADENGINE` | Node kurang baru. Jalankan ulang `bash setup-oracle.sh`. |
| `prisma migrate deploy` → `Can't reach database` | `DATABASE_URL` di `.env` salah/kurang lengkap. Bandingkan dengan `.env` lokal. |
| Bot nyala tapi command Discord tidak muncul | Tunggu 1 menit; cek `pm2 logs` ada baris "slash command didaftarkan". |
| Bot mati setelah VM reboot | Belum jalankan perintah dari `pm2 startup` + `pm2 save`. |
| Balas dobel | Bot lokal belum dimatikan. |
