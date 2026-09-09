import { TextChannel } from 'discord.js';

/**
 * Rapikan channel sebelum memasang panel baru.
 * - bersihkan = true  : hapus semua pesan tak-terpin (maks 100, umur < 14 hari)
 * - bersihkan = false : hanya hapus panel lama milik bot (embed dengan judul `panelTitle`)
 *
 * Mengembalikan string catatan peringatan (untuk ditempel ke balasan) bila ada yang gagal,
 * atau '' bila lancar.
 */
export async function tidyPanelChannel(
  channel: TextChannel,
  opts: { botId: string; panelTitle: string; bersihkan: boolean }
): Promise<string> {
  if (opts.bersihkan) {
    try {
      const msgs = await channel.messages.fetch({ limit: 100 });
      await channel.bulkDelete(
        msgs.filter((m) => !m.pinned),
        true
      );
      return '';
    } catch {
      return '\n\n⚠️ Channel tidak bisa dibersihkan otomatis - pastikan bot punya izin **Manage Messages** di sini. Panel tetap dipasang.';
    }
  }

  try {
    const recent = await channel.messages.fetch({ limit: 50 });
    const old = recent.filter((m) => m.author.id === opts.botId && m.embeds[0]?.title === opts.panelTitle);
    for (const m of old.values()) {
      await m.delete().catch(() => {});
    }
  } catch {
    // abaikan - paling banter panel lama tidak terhapus
  }
  return '';
}
