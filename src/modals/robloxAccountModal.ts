import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { CustomId } from '../types/customIds';

/**
 * Form popup untuk admin menambahkan satu akun Roblox (nama + cookie ".ROBLOSECURITY") ke
 * kumpulan akun yang saldonya dijumlahkan jadi "stok live" (lihat services/roblox/stockPoller,
 * maks MAX_ROBLOX_ACCOUNTS akun). Nilai cookie TIDAK pernah muncul sebagai teks di channel -
 * modal hanya terlihat oleh admin yang membukanya, dan balasannya dibuat ephemeral.
 */
export function buildRobloxAccountModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(CustomId.MODAL_ROBLOX_ACCOUNT).setTitle('Tambah Akun Roblox (Stok Live)');

  const labelInput = new TextInputBuilder()
    .setCustomId(CustomId.INPUT_ROBLOX_ACCOUNT_LABEL)
    .setLabel('Nama akun (bebas, buat Anda sendiri)')
    .setPlaceholder('Contoh: Akun 1')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(50)
    .setRequired(true);

  const cookieInput = new TextInputBuilder()
    .setCustomId(CustomId.INPUT_ROBLOX_COOKIE)
    .setLabel('Cookie .ROBLOSECURITY akun ini')
    .setPlaceholder('Paste seluruh value cookie di sini, diawali _|WARNING:-DO-NOT-SHARE...')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(50)
    .setMaxLength(2000)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(labelInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(cookieInput)
  );
  return modal;
}
