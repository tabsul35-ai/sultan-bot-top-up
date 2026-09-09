/**
 * Session sementara in-memory untuk flow multi-step /buy (modal username -> select jumlah -> konfirmasi).
 * Bukan untuk data permanen - hanya menjembatani antar-interaksi sebelum Order dibuat di database.
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

export function setPendingRobuxUsername(discordId: string, robloxUsername: string) {
  sessions.set(discordId, { robloxUsername, createdAt: Date.now() });
}

export function getPendingRobuxUsername(discordId: string): string | undefined {
  const entry = sessions.get(discordId);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > SESSION_TTL_MS) {
    sessions.delete(discordId);
    return undefined;
  }
  return entry.robloxUsername;
}

export function clearPendingRobuxOrder(discordId: string) {
  sessions.delete(discordId);
}
