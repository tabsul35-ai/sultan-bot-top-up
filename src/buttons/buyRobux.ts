import { ButtonInteraction } from 'discord.js';
import { buildRobloxUsernameModal } from '../modals/robloxUsernameModal';

/**
 * Tombol "Beli Robux" dari /buy -> langsung buka modal username.
 *
 * PENTING: `showModal()` wajib jadi respons pertama dan tidak boleh di-defer, sedangkan
 * Discord hanya memberi 3 detik. Jadi TIDAK ADA akses database di sini (cek anti-spam
 * order aktif kalau dilakukan di titik ini akan bikin interaksi kedaluwarsa saat Neon
 * cold-start). Cek order aktif dilakukan di handleRobloxUsernameSubmit yang memakai defer.
 */
export async function handleBuyRobux(interaction: ButtonInteraction) {
  await interaction.showModal(buildRobloxUsernameModal());
}
