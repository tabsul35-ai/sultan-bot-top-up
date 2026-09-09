import { REST, Routes } from 'discord.js';
import { config } from '../config/config';
import { commands } from './index';

/**
 * Daftarkan semua slash command ke Discord.
 * - Dipanggil otomatis saat bot online (lihat src/index.ts) supaya host 24/7
 *   tidak perlu menjalankan skrip terpisah tiap ada perubahan command.
 * - Masih bisa dijalankan manual: `npm run deploy-commands`.
 */
export async function deployCommands(): Promise<void> {
  const rest = new REST().setToken(config.discordToken);
  const body = commands.map((c) => c.data.toJSON());

  if (config.guildId) {
    // Per-guild: update instan.
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
    console.log(`✅ ${commands.length} slash command didaftarkan ke guild ${config.guildId} (instan).`);
  } else {
    // Global: bisa butuh waktu hingga 1 jam untuk muncul.
    await rest.put(Routes.applicationCommands(config.clientId), { body });
    console.log(`✅ ${commands.length} slash command didaftarkan secara global (bisa butuh ~1 jam untuk muncul).`);
  }
}

// Dijalankan sebagai skrip mandiri (`npm run deploy-commands` / `node dist/commands/deploy-commands.js`).
if (require.main === module) {
  deployCommands().catch((err) => {
    console.error('❌ Gagal deploy command:', err);
    process.exit(1);
  });
}
