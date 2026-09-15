import type { Client } from 'discord.js';
import { prisma, getBotSetting } from '../../database/prisma';
import { config } from '../../config/config';
import { fetchRobuxStock } from './robloxApi';
import { logTransaction } from '../../utils/logger';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 menit
let pollingStarted = false;

/** Cookie aktif: hasil rotasi otomatis Roblox (tersimpan di DB) diprioritaskan atas .env. */
function activeCookie(setting: { robloxCookieOverride: string | null }): string | null {
  return setting.robloxCookieOverride || config.robloxCookie || null;
}

/**
 * Ambil saldo Robux terbaru dari akun Roblox penjual dan simpan sebagai stok live di BotSetting.
 * Dipanggil berkala oleh polling (lihat startRobuxStockPolling), dan sekali lagi secara langsung
 * (bukan dari cache) saat staff memverifikasi pembayaran - supaya pengecekannya seakurat mungkin.
 *
 * Kalau ROBLOX_COOKIE belum diisi, fitur ini nonaktif diam-diam (return cache lama / null) -
 * bot tetap berjalan normal tanpa stok live.
 */
export async function refreshRobuxStock(client?: Client): Promise<number | null> {
  const setting = await getBotSetting();
  const cookie = activeCookie(setting);
  if (!cookie) return setting.robuxStockCache;

  const wasHealthy = !setting.robuxStockError;

  try {
    const { robux, rotatedCookie } = await fetchRobuxStock(cookie);

    await prisma.botSetting.update({
      where: { id: 1 },
      data: {
        robuxStockCache: robux,
        robuxStockUpdatedAt: new Date(),
        robuxStockError: null,
        ...(rotatedCookie && rotatedCookie !== setting.robloxCookieOverride ? { robloxCookieOverride: rotatedCookie } : {}),
      },
    });

    if (!wasHealthy && client) {
      await logTransaction(client, {
        type: 'ADMIN_ACTION',
        title: '✅ Stok Robux pulih',
        message: `Polling saldo Roblox berhasil lagi. Stok saat ini: ${robux.toLocaleString('id-ID')} Robux.`,
      });
    }

    return robux;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error tidak diketahui saat mengambil saldo Roblox.';
    console.error('[roblox stock] Gagal polling saldo Robux:', message);

    await prisma.botSetting.update({ where: { id: 1 }, data: { robuxStockError: message } }).catch(() => {});

    if (wasHealthy && client) {
      await logTransaction(client, {
        type: 'ADMIN_ACTION',
        title: '⚠️ Gagal ambil stok Robux',
        message: `Polling saldo Roblox gagal: ${message}\n\nJual-beli tetap jalan seperti biasa, tapi pengecekan stok otomatis nonaktif sampai ini diperbaiki. Cek \`ROBLOX_COOKIE\` di .env, lalu \`/admin refreshstock\`.`,
      });
    }

    return null;
  }
}

/** Nyalakan polling berkala. Panggil sekali saat bot ready (setelah database & client siap). */
export function startRobuxStockPolling(client: Client) {
  if (pollingStarted) return;
  pollingStarted = true;

  void refreshRobuxStock(client);
  setInterval(() => {
    void refreshRobuxStock(client);
  }, POLL_INTERVAL_MS);
}
