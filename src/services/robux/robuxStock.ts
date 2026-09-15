import type { BotSetting } from '@prisma/client';

type StockSetting = Pick<BotSetting, 'robuxStockCache' | 'robuxStockError' | 'robuxStockUpdatedAt'>;

/** Fitur stok live dianggap aktif kalau pernah berhasil polling minimal sekali. */
export function isStockTrackingEnabled(setting: StockSetting): boolean {
  return setting.robuxStockCache !== null;
}

/**
 * true kalau jumlah yang diminta masih bisa dipenuhi. Kalau stok live belum diatur
 * (ROBLOX_COOKIE kosong / belum pernah berhasil polling), selalu true - fitur tidak
 * menghalangi transaksi manual seperti biasa.
 */
export function hasEnoughStock(amount: number, setting: StockSetting): boolean {
  if (setting.robuxStockCache === null) return true;
  return amount <= setting.robuxStockCache;
}

export function formatStockLine(setting: StockSetting): string {
  if (setting.robuxStockCache === null) {
    return setting.robuxStockError ? `⚠️ Stok live gagal diambil (${setting.robuxStockError})` : 'Stok live belum diatur';
  }
  const staleness = setting.robuxStockError ? ' ⚠️ (polling terakhir gagal, angka ini bisa sudah usang)' : '';
  return `${setting.robuxStockCache.toLocaleString('id-ID')} Robux${staleness}`;
}
