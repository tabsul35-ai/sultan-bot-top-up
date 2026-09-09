import { PrismaClient } from '@prisma/client';

// Singleton agar tidak membuka banyak koneksi database saat hot-reload
export const prisma = new PrismaClient();

/**
 * Ambil BotSetting (harga robux, role staff/admin, dsb).
 * Membuat baris default jika belum ada.
 */
export async function getBotSetting() {
  let setting = await prisma.botSetting.findUnique({ where: { id: 1 } });
  if (!setting) {
    setting = await prisma.botSetting.create({ data: { id: 1 } });
  }
  return setting;
}

/**
 * Ambil PaymentSetting (QRIS/DANA/OVO/GoPay/Bank).
 * Membuat baris default jika belum ada.
 */
export async function getPaymentSetting() {
  let setting = await prisma.paymentSetting.findUnique({ where: { id: 1 } });
  if (!setting) {
    setting = await prisma.paymentSetting.create({ data: { id: 1 } });
  }
  return setting;
}
