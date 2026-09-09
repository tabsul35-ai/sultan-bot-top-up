# 👑 Sultan Top Up Bot — Robux (Manual Payment)

Bot Discord untuk jualan Robux dengan sistem ticket otomatis dan verifikasi pembayaran manual (tanpa payment gateway).

Fitur di versi ini:
- `/buy` → flow beli Robux lengkap (username → jumlah → konfirmasi → ticket otomatis)
- `/pay` → menampilkan info pembayaran manual (QRIS/DANA/OVO/GoPay/Bank) yang admin atur
- Deteksi otomatis saat customer upload bukti bayar (gambar) di ticket → tombol verifikasi muncul untuk staff
- `/admin` → atur harga Robux, metode pembayaran, role staff/admin, channel log
- `/history` → riwayat transaksi user
- Logging semua transaksi ke channel & database

---

## Langkah 1 — Install software yang dibutuhkan

1. **Node.js** (versi 20 ke atas) → download di https://nodejs.org (pilih versi LTS). Setelah install, cek dengan buka Command Prompt/Terminal lalu ketik:
   ```
   node -v
   ```
   Kalau muncul angka versi (misal `v20.x.x`), berarti berhasil.

2. **PostgreSQL** (database) → download di https://www.postgresql.org/download/. Saat instalasi, catat **password** yang Anda buat untuk user `postgres` — akan dipakai nanti.
   - Alternatif lebih mudah: pakai database gratis online seperti [Neon](https://neon.tech) atau [Supabase](https://supabase.com) — tinggal daftar, buat project, lalu copy "Connection String"-nya. Tidak perlu install apa-apa di komputer.

3. **Editor kode** (opsional tapi disarankan) → [VS Code](https://code.visualstudio.com/).

---

## Langkah 2 — Buat aplikasi Bot Discord

1. Buka https://discord.com/developers/applications
2. Klik **New Application**, beri nama misalnya `Sultan Top Up`.
3. Di menu kiri, klik **Bot**.
4. Klik **Reset Token** → **Copy** token yang muncul. Ini nilai untuk `DISCORD_TOKEN` di `.env`. **Jangan bagikan token ini ke siapa pun.**
5. Di halaman Bot yang sama, scroll ke bawah, aktifkan:
   - ✅ **MESSAGE CONTENT INTENT** (wajib, supaya bot bisa mendeteksi bukti pembayaran yang di-upload)
6. Di menu kiri, klik **General Information** → copy **Application ID**. Ini nilai untuk `DISCORD_CLIENT_ID`.

### Undang bot ke server Anda
1. Masih di halaman Developer Portal, buka menu **OAuth2 → URL Generator**.
2. Centang scope: `bot` dan `applications.commands`.
3. Di bagian **Bot Permissions**, centang: `Manage Channels`, `Manage Roles`, `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `View Channels`.
4. Copy URL yang muncul di bawah, buka di browser, pilih server Discord Anda, klik **Authorize**.

### Ambil Server ID (Guild ID)
1. Di aplikasi Discord Anda, buka **Settings (User Settings) → Advanced → Developer Mode** → aktifkan.
2. Klik kanan nama/icon server Anda → **Copy Server ID**. Ini nilai untuk `DISCORD_GUILD_ID`.

---

## Langkah 3 — Download & install project

1. Extract/salin folder project ini ke komputer Anda.
2. Buka folder tersebut lewat Terminal/Command Prompt (di VS Code: klik kanan folder → "Open in Integrated Terminal").
3. Install semua dependency:
   ```
   npm install
   ```

---

## Langkah 4 — Isi file `.env`

1. Duplikat file `.env.example`, ganti nama jadi `.env`.
2. Buka `.env`, isi setiap baris:
   ```
   DISCORD_TOKEN=token_bot_dari_langkah_2
   DISCORD_CLIENT_ID=application_id_dari_langkah_2
   DISCORD_GUILD_ID=server_id_dari_langkah_2
   DATABASE_URL=postgresql://postgres:password_anda@localhost:5432/sultan_topup
   ```
   Jika Anda pakai Neon/Supabase, tinggal paste "Connection String" yang mereka berikan ke `DATABASE_URL`.

3. Jika pakai PostgreSQL lokal, buat database-nya dulu. Buka terminal lalu:
   ```
   psql -U postgres
   ```
   Masukkan password, lalu di dalam psql:
   ```sql
   CREATE DATABASE sultan_topup;
   \q
   ```

---

## Langkah 5 — Setup database (Prisma)

Jalankan perintah ini untuk membuat semua tabel yang dibutuhkan bot (User, Order, PaymentSetting, dst) berdasarkan `prisma/schema.prisma`:

```
npx prisma migrate dev --name init
```

Kalau berhasil, akan muncul pesan sukses dan folder `prisma/migrations` terbentuk.

---

## Langkah 6 — Daftarkan slash command ke Discord

```
npm run deploy-commands
```

Karena Anda mengisi `DISCORD_GUILD_ID`, command akan langsung muncul di server Anda (instan, tidak perlu tunggu 1 jam).

---

## Langkah 7 — Jalankan bot

Untuk development (auto-restart saat ada perubahan kode):
```
npm run dev
```

Kalau muncul log:
```
✅ Terhubung ke database.
👑 Sultan Top Up Bot online sebagai SultanTopUp#1234
```
Bot Anda sudah online! Cek di server Discord, status bot harus hijau (online).

---

## Langkah 8 — Konfigurasi awal via `/admin`

Di server Discord Anda, ketik command berikut satu per satu (butuh permission Administrator atau role admin):

1. **Atur role staff & admin** (buat dulu role-nya di Server Settings → Roles kalau belum ada):
   ```
   /admin setroles staff:@Staff admin:@Admin
   ```

2. **Atur channel log & kategori ticket** (buat dulu category "🎫 Tickets" dan channel "📜・transaction-log"):
   ```
   /admin setchannel log:#transaction-log kategori:🎫 Tickets
   ```

3. **Atur harga Robux** (default sudah Rp160/Robux sesuai PRD, ganti kalau perlu):
   ```
   /admin setprice harga:160
   ```

4. **Atur metode pembayaran** (ulangi untuk tiap metode yang Anda pakai):
   ```
   /admin setpayment metode:QRIS nomor:081234567890
   /admin setpayment metode:DANA nomor:081234567890
   /admin setpayment metode:Bank Transfer nomor:1234567890 nama_bank:BCA atas_nama:Nama Anda
   ```

5. Cek semua pengaturan:
   ```
   /admin settings
   ```

---

## Langkah 9 — Coba flow lengkap sebagai customer

1. Ketik `/buy` di channel manapun.
2. Klik **💰 Beli Robux**.
3. Isi username Roblox di form yang muncul.
4. Pilih jumlah Robux dari dropdown.
5. Klik **✅ Lanjutkan** → bot otomatis membuat channel ticket baru (`robux-username`).
6. Di dalam ticket, ketik `/pay` atau klik tombol **💳 Pembayaran** → muncul info rekening/QRIS.
7. Upload screenshot bukti transfer (drag file ke chat) → bot otomatis mendeteksi dan memunculkan tombol verifikasi untuk staff.
8. Sebagai staff, klik **✅ Pembayaran Valid**.
9. Kirim Robux secara manual ke akun Roblox customer, lalu klik **✅ Robux Terkirim**.
10. Klik **🔒 Tutup Ticket** untuk menutup channel.

Semua transaksi tercatat otomatis di channel log dan bisa dilihat lewat `/admin stats`.

---

## Menjalankan di server produksi (24/7)

Development (`npm run dev`) mati begitu Anda menutup terminal/laptop. Untuk bot yang jalan terus-menerus, ada beberapa opsi:

- **VPS murah** (misal di provider lokal atau DigitalOcean/Contabo): install Node.js + PostgreSQL di VPS, lalu jalankan dengan [pm2](https://pm2.keymetrics.io/) supaya otomatis restart jika crash:
  ```
  npm run build
  npm install -g pm2
  pm2 start dist/index.js --name sultan-topup-bot
  pm2 save
  ```
- **Railway / Render**: platform hosting yang mendukung Node.js + PostgreSQL, cocok untuk pemula karena tidak perlu setup server manual.

---

## Troubleshooting

| Masalah | Penyebab umum |
|---|---|
| Command `/buy` tidak muncul di Discord | Belum jalankan `npm run deploy-commands`, atau salah `DISCORD_GUILD_ID` |
| Bot tidak merespons sama sekali | Cek `DISCORD_TOKEN` benar, dan intent **MESSAGE CONTENT** sudah diaktifkan di Developer Portal |
| Error `Environment variable DATABASE_URL wajib diisi` | File `.env` belum dibuat atau salah nama (harus persis `.env`, bukan `.env.example`) |
| Bot tidak bisa deteksi bukti bayar | Pastikan intent **MESSAGE CONTENT** aktif, dan bukti di-upload oleh user yang sama dengan pembuat order |
| Bot tidak bisa buat channel ticket | Permission bot kurang — pastikan role bot punya `Manage Channels` dan posisi role bot di atas role biasa |

---

## Yang belum ada di versi ini (dari PRD lengkap)

Fokus versi ini hanya **Robux + ticket + payment manual**. Belum diimplementasikan:
- Sistem Kostum
- Sistem Rekber/Escrow + Dispute
- `/setup` otomatis (saat ini kategori/channel/role harus dibuat manual lalu dikonfigurasi lewat `/admin`)
- Payment gateway otomatis (QRIS/VA otomatis via API)

Beri tahu saya kalau Anda ingin lanjut ke salah satu fitur ini.
