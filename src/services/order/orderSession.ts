/**
 * Session sementara in-memory untuk flow multi-step /buy (modal username -> select jumlah -> konfirmasi).
 * Bukan untuk data permanen - hanya menjembatani antar-interaksi sebelum Order dibuat di database.
 *
 * Di-key per (guildId, discordId) supaya user yang sama bisa punya sesi terpisah kalau sedang
 * order di dua server (toko) berbeda secara bersamaan.
 *
 * Catatan: jika bot di-deploy multi-instance/cluster, ganti dengan Redis atau store lain yang shared.
 * Untuk single-instance (kasus umum bot Discord kecil-menengah), Map ini cukup.
 */

type PendingRobuxOrder = {
  robloxUsername: string;
  createdAt: number;
};

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 menit

const sessions = new Map<string, PendingRobuxOrder>();

function key(guildId: string, discordId: string): string {
  return `${guildId}:${discordId}`;
}

export function setPendingRobuxUsername(guildId: string, discordId: string, robloxUsername: string) {
  sessions.set(key(guildId, discordId), { robloxUsername, createdAt: Date.now() });
}

export function getPendingRobuxUsername(guildId: string, discordId: string): string | undefined {
  const k = key(guildId, discordId);
  const entry = sessions.get(k);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > SESSION_TTL_MS) {
    sessions.delete(k);
    return undefined;
  }
  return entry.robloxUsername;
}

export function clearPendingRobuxOrder(guildId: string, discordId: string) {
  sessions.delete(key(guildId, discordId));
}
