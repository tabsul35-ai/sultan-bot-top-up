import { StringSelectMenuInteraction } from 'discord.js';
import { buildRobloxUsernameModal } from '../modals/robloxUsernameModal';
import { buildRobuxCustomModal } from '../modals/robuxCustomModal';
import { PANEL_ROBUX_CUSTOM_VALUE } from '../panels/robuxPanel';
import { getActiveOrderForUser } from '../services/order/orderService';
import { isValidRobuxAmount } from '../services/robux/robuxPricing';
import { errorEmbed } from '../utils/embeds';

/**
 * Dipicu saat user memilih nominal dari panel permanen (/panel).
 * Karena panel dipakai bersama banyak orang, di sini kita:
 *  1. cek anti-spam (satu order aktif per user),
 *  2. buka modal:
 *     - opsi angka tetap  -> modal username saja (jumlah sudah diketahui dari value),
 *     - opsi "custom"      -> modal jumlah Robux + username.
 *
 * Sisa alur (ringkasan harga -> konfirmasi -> ticket) sama persis dengan alur /buy.
 */
export async function handlePanelRobuxSelect(interaction: StringSelectMenuInteraction) {
  const activeOrder = await getActiveOrderForUser(interaction.user.id);
  if (activeOrder) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          `Anda masih memiliki order aktif (**${activeOrder.orderCode}**). Selesaikan atau batalkan order tersebut terlebih dahulu.`
        ),
      ],
      ephemeral: true,
    });
    return;
  }

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
