import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { ROBUX_CUSTOM_MAX, ROBUX_CUSTOM_MIN } from '../services/robux/robuxPricing';
import { CustomId } from '../types/customIds';

/**
 * Modal untuk opsi "Jumlah lain (custom)" di panel: satu popup menampung dua isian sekaligus
 * (jumlah Robux + username Roblox), karena Discord tidak mengizinkan membuka modal kedua
 * sebagai balasan atas submit modal pertama.
 */
export function buildRobuxCustomModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(CustomId.MODAL_ROBUX_CUSTOM).setTitle('Pesan Robux (Jumlah Custom)');

  const amountInput = new TextInputBuilder()
    .setCustomId(CustomId.INPUT_ROBUX_AMOUNT)
    .setLabel(`Jumlah Robux (${ROBUX_CUSTOM_MIN}-${ROBUX_CUSTOM_MAX})`)
    .setPlaceholder('Contoh: 3500')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(7)
    .setRequired(true);

  const usernameInput = new TextInputBuilder()
    .setCustomId(CustomId.INPUT_ROBLOX_USERNAME)
    .setLabel('Username Roblox Anda')
    .setPlaceholder('Contoh: SultanPlayer')
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(32)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(usernameInput)
  );
  return modal;
}
