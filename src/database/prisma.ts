import { PrismaClient } from '@prisma/client';

// Singleton agar tidak membuka banyak koneksi database saat hot-reload
export const prisma = new PrismaClient();

/**
 * Neon (free tier) menidurkan compute setelah ~5 menit idle. Query pertama saat
 * "bangun" bisa gagal P1001/P1002/P1017 walau beberapa detik kemudian sudah normal.
 * Middleware ini mengulang query yang kena error koneksi sementara, jadi user tidak
 * langsung dapat "Terjadi kesalahan".
 */
const TRANSIENT_DB_ERRORS = new Set(['P1001', 'P1002', 'P1008', 'P1017']);

prisma.$use(async (params, next) => {
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await next(params);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (!code || !TRANSIENT_DB_ERRORS.has(code) || attempt >= maxAttempts) throw err;
      // jeda 0.7s lalu 1.4s - biasanya cukup untuk Neon bangun tanpa melewati batas 3 detik Discord
      await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
    }
  }
});

/**
 * Ambil BotSetting satu server (harga robux, role staff/admin, stok, dsb) - tiap server
 * Discord (guildId) toko independen sendiri. Membuat baris default jika belum ada.
 */
export async function getBotSetting(guildId: string) {
  let setting = await prisma.botSetting.findUnique({ where: { guildId } });
  if (!setting) {
    setting = await prisma.botSetting.create({ data: { guildId } });
  }
  return setting;
}

/**
 * Ambil PaymentSetting satu server (QRIS/DANA/OVO/GoPay/Bank). Membuat baris default jika belum ada.
 */
export async function getPaymentSetting(guildId: string) {
  let setting = await prisma.paymentSetting.findUnique({ where: { guildId } });
  if (!setting) {
    setting = await prisma.paymentSetting.create({ data: { guildId } });
  }
  return setting;
}
