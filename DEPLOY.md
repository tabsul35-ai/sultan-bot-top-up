# Deploy 24/7 ke Fly.io

> **Catatan:** Bot ini sekarang di-deploy ke **VPS RumahWeb** dengan database **PostgreSQL lokal**.
> Panduan yang berlaku: [DEPLOY-VPS.md](DEPLOY-VPS.md). Dokumen Fly.io + Neon di bawah ini
> disimpan sebagai arsip dan tidak lagi dipakai.

Panduan agar bot tetap online walau PC dimatikan. Database tetap memakai **Neon** (yang sekarang) — tidak perlu diubah.

> Biaya: Fly.io tidak lagi punya "free tier" resmi, tapi tidak menagih pemakaian di bawah ~$5/bulan.
> 1 mesin `shared-cpu-1x` 512MB nonstop ≈ $3/bulan → praktis gratis. Tetap wajib memasukkan kartu untuk verifikasi.

---

## 0. Yang harus sudah ada

- **Node.js** ✔ (sudah)
- **Git** → install dari https://git-scm.com/download/win (Next terus), lalu tutup & buka ulang terminal
- Akun **GitHub** (untuk backup kode — opsional tapi disarankan)
- Nilai dari file `.env` lokal: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `DATABASE_URL`

---

## 1. (Opsional) Simpan kode ke GitHub

Di folder project (`...\sultan-topup-bot\sultan-topup-bot`):

```bash
git init
git add .
git commit -m "Sultan Top Up Bot"
```

Buat repo kosong di https://github.com/new (mis. `sultan-topup-bot`, set **Private**), lalu:

```bash
git remote add origin https://github.com/USERNAME/sultan-topup-bot.git
git branch -M main
git push -u origin main
```

> File `.env` **tidak** ikut ter-upload (sudah diblokir `.gitignore`). Aman.

---

## 2. Install Fly CLI

Buka **PowerShell**, jalankan:

```powershell
pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

(kalau `pwsh` tidak ada, pakai `powershell` di depannya)

Tutup & buka ulang terminal, cek:

```bash
fly version
```

---

## 3. Buat akun & login

```bash
fly auth signup      # atau: fly auth login  (kalau daftar lewat web fly.io dulu)
```

Ikuti proses di browser, masukkan kartu untuk verifikasi.

---

## 4. Siapkan app

Di folder project:

```bash
fly launch --no-deploy
```

Jawaban saat ditanya:
- **App name**: tekan Enter (pakai `sultan-topup-bot`) atau ketik nama unik kalau sudah dipakai
- **Region**: `sin` (Singapore)
- **Postgres / Redis / database?** → **No** (kita pakai Neon)
- **Overwrite fly.toml?** → **Yes** boleh (setting penting tetap dipertahankan; kalau ragu jawab No)

---

## 5. Masukkan secret (isi dari `.env` lokal Anda)

```bash
fly secrets set DISCORD_TOKEN="ISI_TOKEN" DISCORD_CLIENT_ID="ISI_CLIENT_ID" DISCORD_GUILD_ID="ISI_GUILD_ID" DATABASE_URL="ISI_DATABASE_URL_NEON"
```

> `DATABASE_URL` = string Neon yang sama persis dengan yang di `.env` (termasuk `?sslmode=require...`). Bungkus dengan tanda kutip.

---

## 6. Deploy

```bash
fly deploy
```

Ini akan: build image → jalankan `prisma migrate deploy` (bikin/menyamakan tabel) → menyalakan bot.

---

## 7. Pastikan hanya 1 instance

```bash
fly scale count 1
```

⚠️ Kalau ada 2 mesin, bot akan membalas dobel. Harus **1**.

---

## 8. Cek log

```bash
fly logs
```

Cari baris:
```
✅ Terhubung ke database.
👑 Sultan Top Up Bot online sebagai sultan topup#0749
✅ 9 slash command didaftarkan ke guild ...
```

Kalau muncul itu → bot sudah online 24/7. Status di Discord jadi hijau.

---

## 9. MATIKAN bot lokal

Di jendela terminal tempat `npm run dev` jalan → tekan **Ctrl + C**.

Kalau bot lokal dan bot Fly jalan bersamaan, keduanya membalas setiap interaksi (dobel). Mulai sekarang cukup yang di Fly.

---

## Update bot ke depannya

Setiap kali ada perubahan kode:

```bash
git add . && git commit -m "update"      # kalau pakai GitHub
git push                                  # kalau pakai GitHub
fly deploy
```

Slash command otomatis didaftarkan ulang tiap bot restart — tidak perlu `deploy-commands` manual.

---

## Perintah Fly yang berguna

| Perintah | Fungsi |
|---|---|
| `fly logs` | Lihat log real-time |
| `fly status` | Status mesin |
| `fly apps restart sultan-topup-bot` | Restart bot |
| `fly secrets list` | Lihat nama secret (nilainya tersembunyi) |
| `fly secrets set NAMA="baru"` | Ganti 1 secret (bot auto-restart) |
| `fly scale memory 256` | Turunkan RAM ke 256MB (lebih murah, coba kalau mau hemat) |
| `fly dashboard` | Buka panel web |

---

## Kalau error

| Gejala di `fly logs` | Sebab & solusi |
|---|---|
| `Environment variable DISCORD_TOKEN wajib diisi` | Secret belum di-set / salah nama. Ulangi langkah 5. |
| `Can't reach database server` | `DATABASE_URL` salah, atau Neon project dihapus. Cek di dashboard Neon. |
| Bot balas dobel | Masih ada instance lain (bot lokal belum dimatikan, atau `fly scale count` > 1). |
| `Out of memory` / mesin restart terus | `fly scale memory 512` (atau 1024). |
| Command Discord tidak update | Tunggu ~1 menit setelah restart; cek `fly logs` ada baris "slash command didaftarkan". |
