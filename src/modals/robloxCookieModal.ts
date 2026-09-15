import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { CustomId } from '../types/customIds';

/**
 * Form popup untuk admin menempelkan cookie ".ROBLOSECURITY" langsung dari Discord, jadi tidak
 * perlu SSH ke server tiap kali ganti/refresh cookie. Nilainya TIDAK pernah muncul sebagai teks
 * di channel - modal hanya terlihat oleh admin yang membukanya, dan balasannya dibuat ephemeral.
 */
export function buildRobloxCookieModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(CustomId.MODAL_ROBLOX_COOKIE).setTitle('Atur Cookie Roblox (Stok Live)');

  const input = new TextInputBuilder()
    .setCustomId(CustomId.INPUT_ROBLOX_COOKIE)
    .setLabel('Cookie .ROBLOSECURITY akun jualan')
    .setPlaceholder('Paste seluruh value cookie di sini, diawali _|WARNING:-DO-NOT-SHARE...')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(50)
    .setMaxLength(2000)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  return modal;
}
