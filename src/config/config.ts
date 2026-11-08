import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} wajib diisi (cek file .env)`);
  }
  return value;
}

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  guildId: process.env.DISCORD_GUILD_ID || '', // opsional, untuk deploy command per-guild (lebih cepat saat dev)
  databaseUrl: required('DATABASE_URL'),
};

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    console.warn(`⚠️ ${name}="${raw}" tidak valid (harus ${min}-${max}), memakai default ${fallback}.`);
    return fallback;
  }
  return n;
}

/** "7,3,1" -> [7, 3, 1] (unik, urut menurun). Nilai tidak valid diabaikan. */
function daysListEnv(name: string, fallback: number[]): number[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  const days = [...new Set(raw.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= 60))];
  if (days.length === 0) {
    console.warn(`⚠️ ${name}="${raw}" tidak valid, memakai default ${fallback.join(',')}.`);
    return fallback;
  }
  return days.sort((a, b) => b - a);
}

/**
 * Konfigurasi fitur Manajemen Akun Redfinger (/redfinger). Semua opsional - bot tetap jalan
 * tanpa satu pun variabel ini. Channel admin/log & role diatur per server lewat /redfinger setup.
 */
export const redfingerConfig = {
  // Kunci AES-256 (32 byte, base64 atau hex) untuk mengenkripsi password akun Redfinger.
  // Kosong = bot menolak menyimpan password (akun tetap bisa dikelola tanpa password).
  encryptionKey: process.env.REDFINGER_ENCRYPTION_KEY || '',
  // Tahap pengingat (hari sebelum jatuh tempo). Notifikasi "sudah habis" selalu dikirim.
  reminderDays: daysListEnv('REDFINGER_REMINDER_DAYS', [7, 3, 1]),
  // Seberapa sering scheduler mengecek masa aktif.
  checkIntervalMinutes: intEnv('REDFINGER_CHECK_INTERVAL_MINUTES', 30, 1, 1440),
  // Zona waktu input/tampilan tanggal (Indonesia tanpa DST: WIB=7, WITA=8, WIT=9).
  utcOffsetHours: intEnv('REDFINGER_UTC_OFFSET_HOURS', 7, -12, 14),
  // Sinkron ulang otomatis akun login (Register) tiap N jam supaya masa aktif selalu terbaru. 0 = mati.
  syncIntervalHours: intEnv('REDFINGER_SYNC_INTERVAL_HOURS', 12, 0, 168),
  // Mode default alur renew: "manual" (checklist untuk admin) atau "browser" (Playwright, opsional).
  renewMode: (process.env.REDFINGER_RENEW_MODE === 'browser' ? 'browser' : 'manual') as 'manual' | 'browser',
  browser: {
    // Otomasi browser hanya aktif jika ini "true" DAN paket `playwright` terpasang.
    enabled: process.env.REDFINGER_BROWSER_ENABLED === 'true',
    headless: process.env.REDFINGER_BROWSER_HEADLESS !== 'false',
    timeoutMs: intEnv('REDFINGER_BROWSER_TIMEOUT_MS', 120_000, 10_000, 600_000),
  },
};

export const BRAND = {
  name: 'SULTAN TOP UP',
  emoji: '👑',
  color: 0xf1c40f, // gold
  errorColor: 0xe74c3c,
  successColor: 0x2ecc71,
  pendingColor: 0xf39c12,
};
