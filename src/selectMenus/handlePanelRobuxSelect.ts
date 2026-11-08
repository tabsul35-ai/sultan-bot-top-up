import { StringSelectMenuInteraction } from 'discord.js';
import { buildRobloxUsernameModal } from '../modals/robloxUsernameModal';
import { buildRobuxCustomModal } from '../modals/robuxCustomModal';
import { PANEL_ROBUX_CUSTOM_VALUE } from '../panels/robuxPanel';
import { isValidRobuxAmount } from '../services/robux/robuxPricing';
import { errorEmbed } from '../utils/embeds';

/**
 * Dipicu saat user memilih nominal dari panel permanen (/panel).
 *
 * PENTING: interaksi yang membuka modal tidak boleh di-defer dulu - `showModal()`
 * wajib jadi respons pertama, dan Discord hanya memberi 3 detik. Karena itu di sini
 * TIDAK ADA akses database (mis. cek anti-spam order aktif). Kalau database Neon
 * sedang cold-start, query di titik ini bikin interaksi kedaluwarsa
 * ("The application didn't respond in time"). Cek order aktif dipindah ke handler
 * submit modal (handleRobloxUsernameSubmit / handleRobuxCustomSubmit) yang boleh
 * memakai deferReply.
 *
 * Alur:
 *  - opsi angka tetap -> modal username saja (jumlah sudah diketahui dari value),
 *  - opsi "custom"     -> modal jumlah Robux + username.
 * Sisa alur (ringkasan harga -> konfirmasi -> ticket) sama persis dengan alur /buy.
 */
export async function handlePanelRobuxSelect(interaction: StringSelectMenuInteraction) {
  const value = interaction.values[0];

  if (value === PANEL_ROBUX_CUSTOM_VALUE) {
    await interaction.showModal(buildRobuxCustomModal());
    return;
  }

  const amount = Number(value);
  if (!isValidRobuxAmount(amount)) {
    await interaction.reply({ embeds: [errorEmbed('Jumlah Robux tidak valid.')], ephemeral: true });
    return;
  }

  await interaction.showModal(buildRobloxUsernameModal(amount));
}
