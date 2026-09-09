import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { baseEmbed } from '../utils/embeds';
import { CustomId } from '../types/customIds';

// Judul embed panel verifikasi - dipakai juga oleh /setup-verify untuk menghapus panel lama.
export const VERIFY_PANEL_TITLE = '✅ Verifikasi Member';

export function buildVerifyPanel() {
  const embed = baseEmbed()
    .setTitle(VERIFY_PANEL_TITLE)
    .setDescription(
      [
        'Selamat datang di server! Tekan tombol **Verifikasi** di bawah untuk membuka akses ke seluruh channel.',
        '',
        'Dengan menekan tombol, Anda dianggap menyetujui peraturan server.',
      ].join('\n')
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CustomId.VERIFY_BUTTON)
      .setLabel('Verifikasi')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row] };
}
