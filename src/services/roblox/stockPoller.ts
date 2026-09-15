import type { Client } from 'discord.js';
import { prisma } from '../../database/prisma';
import { fetchRobuxStock } from './robloxApi';
import { logTransaction } from '../../utils/logger';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 menit
export const MAX_ROBLOX_ACCOUNTS = 5;
let pollingStarted = false;

/**
 * Ambil saldo tiap akun Roblox aktif (diatur lewat /admin addrobloxaccount, maks
 * MAX_ROBLOX_ACCOUNTS), jumlahkan jadi satu angka "stok live", lalu simpan ringkasannya ke
 * BotSetting - satu-satunya tempat yang dibaca kode lain (hasEnoughStock, panel, /admin
 * settings, pengecekan ulang saat verifikasi pembayaran). Detail per-akun (termasuk error
 * individual) tersimpan di baris RobloxAccount masing-masing, lihat /admin listrobloxaccounts.
 *
 * Kalau belum ada akun yang diatur, return null - fitur nonaktif diam-diam, bot jalan normal
 * seperti transaksi manual biasa.
 *
 * Satu akun yang gagal dipoll tidak menjatuhkan seluruh total ke 0 - saldo terakhir yang
 * diketahui akun itu tetap dihitung, supaya blip sesaat di satu akun tidak memblokir transaksi
 * yang sebetulnya masih bisa dipenuhi akun lain.
 */
export async function refreshRobuxStock(client?: Client): Promise<number | null> {
  const accounts = await prisma.robloxAccount.findMany({ where: { active: true } });
  if (accounts.length === 0) return null;

  let total = 0;
  let anySuccess = false;
  const failedLabels: string[] = [];

  for (const account of accounts) {
    const accountWasHealthy = !account.stockError;

    try {
      const { robux, rotatedCookie } = await fetchRobuxStock(account.cookie);

      await prisma.robloxAccount.update({
        where: { id: account.id },
        data: {
          stockCache: robux,
          stockUpdatedAt: new Date(),
          stockError: null,
          ...(rotatedCookie && rotatedCookie !== account.cookie ? { cookie: rotatedCookie } : {}),
        },
      });
      total += robux;
      anySuccess = true;

      if (!accountWasHealthy && client) {
        await logTransaction(client, {
          type: 'ADMIN_ACTION',
          title: '✅ Akun Roblox pulih',
          message: `Akun **${account.label}** berhasil dipoll lagi. Saldo: ${robux.toLocaleString('id-ID')} Robux.`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error tidak diketahui saat mengambil saldo Roblox.';
      console.error(`[roblox stock] Gagal polling akun "${account.label}":`, message);

      await prisma.robloxAccount.update({ where: { id: account.id }, data: { stockError: message } }).catch(() => {});
      failedLabels.push(account.label);
      total += account.stockCache ?? 0;

      if (accountWasHealthy && client) {
        await logTransaction(client, {
          type: 'ADMIN_ACTION',
          title: '⚠️ Gagal ambil saldo akun Roblox',
          message: `Akun **${account.label}** gagal dipoll: ${message}\n\nAkun lain tetap dihitung normal. Cek \`/admin listrobloxaccounts\`, perbarui cookie-nya lewat \`/admin removerobloxaccount\` lalu \`/admin addrobloxaccount\` lagi.`,
        });
      }
    }
  }

  await prisma.botSetting.upsert({
    where: { id: 1 },
    update: {
      robuxStockCache: total,
      ...(anySuccess ? { robuxStockUpdatedAt: new Date() } : {}),
      robuxStockError: failedLabels.length ? `${failedLabels.length}/${accounts.length} akun gagal dipoll (${failedLabels.join(', ')})` : null,
    },
    create: { id: 1, robuxStockCache: total, robuxStockUpdatedAt: anySuccess ? new Date() : null },
  });

  return total;
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
