import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { CustomId, buildCustomId } from '../types/customIds';

/**
 * @param robuxAmount jika diisi (alur panel), jumlah robux disisipkan ke custom_id modal
 *   supaya handler submit bisa langsung ke ringkasan harga tanpa menampilkan pilihan jumlah lagi.
 */
export function buildRobloxUsernameModal(robuxAmount?: number): ModalBuilder {
  const customId =
    robuxAmount != null ? buildCustomId(CustomId.MODAL_ROBLOX_USERNAME, robuxAmount) : CustomId.MODAL_ROBLOX_USERNAME;

  const modal = new ModalBuilder().setCustomId(customId).setTitle('Masukkan Username Roblox');

  const input = new TextInputBuilder()
    .setCustomId(CustomId.INPUT_ROBLOX_USERNAME)
    .setLabel('Username Roblox Anda')
    .setPlaceholder('Contoh: SultanPlayer')
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(32)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  return modal;
}
