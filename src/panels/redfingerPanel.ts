import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { baseEmbed } from '../utils/embeds';
import { CustomId } from '../types/customIds';

// Judul embed panel - dipakai juga oleh /redfinger panel untuk mengenali & menghapus panel lama.
export const PANEL_REDFINGER_TITLE = '📱 Panel Manajemen Redfinger';

/**
 * Panel Redfinger permanen untuk channel admin (dipasang lewat /redfinger panel).
 * Panel ini statis (tidak memuat data akun), jadi tidak pernah basi. Semua data muncul
 * sebagai balasan ephemeral setelah tombol ditekan, dan setiap tombol mengecek izin admin
 * Redfinger. Member biasa yang melihat panel tidak bisa memakainya.
 */
export function buildRedfingerPanel() {
  const embed = baseEmbed()
    .setTitle(PANEL_REDFINGER_TITLE)
    .setDescription(
      [
        'Kelola akun/instance Redfinger tanpa mengetik command.',
        '',
        '➕ **Tambah Akun**: daftarkan akun/instance baru (form popup)',
        '📋 **Daftar Akun**: status & masa aktif semua akun',
        '🛠️ **Kelola Akun**: pilih akun → detail, Renew, Replace, Tandai Selesai, Nonaktifkan, Ganti Password, Hapus',
        '⚙️ **Pengaturan**: channel pengingat/log, role, dan konfigurasi',
        '',
        '🔒 Khusus admin Redfinger. Semua balasan hanya terlihat oleh Anda, dan password tidak pernah ditampilkan.',
      ].join('\n')
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CustomId.RF_PANEL_ADD).setLabel('Tambah Akun').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(CustomId.RF_PANEL_LIST).setLabel('Daftar Akun').setEmoji('📋').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CustomId.RF_PANEL_MANAGE).setLabel('Kelola Akun').setEmoji('🛠️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CustomId.RF_PANEL_SETUP).setLabel('Pengaturan').setEmoji('⚙️').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}
