import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { baseEmbed } from '../utils/embeds';
import { CustomId } from '../types/customIds';

// Judul embed panel - dipakai /redfinger panel untuk mengenali & menghapus panel lama.
export const PANEL_REDFINGER_TITLE = '📱 Sultan Redfinger Manager';
// Judul panel versi sebelumnya - ikut dibersihkan saat panel baru dipasang.
export const PANEL_REDFINGER_TITLE_OLD = '📱 Panel Manajemen Redfinger';

export interface PanelStats {
  logins: number;
  devices: number;
  active: number;
  expiring: number;
  expired: number;
  syncs: number;
  redeems: number;
  renews: number;
  replaces: number;
}

const num = (n: number) => `\`${n.toLocaleString('id-ID')}\``;

/**
 * Panel Redfinger Manager permanen (dipasang lewat /redfinger panel di channel admin).
 * Statistik diperbarui setiap kali tombol panel ditekan. Semua hasil tombol tampil ephemeral
 * dan setiap tombol mengecek izin admin Redfinger.
 */
export function buildRedfingerPanel(stats: PanelStats) {
  const embed = baseEmbed()
    .setTitle(PANEL_REDFINGER_TITLE)
    .setDescription('Kelola cloud phone Redfinger langsung dari Discord: login sekali, device & masa aktif tersinkron otomatis.')
    .addFields(
      {
        name: '⚙️ FITUR',
        value: [
          '🔐 **Register**: login akun Redfinger (email + password), device & masa aktif dibaca otomatis',
          '🎟️ **Redeem**: tambah cloud phone dengan kode',
          '🔁 **Replace**: ganti akun/instance device',
          '🔋 **Renew**: perpanjang masa aktif device',
          '⏰ Pengingat otomatis H-7 / H-3 / H-1 / habis',
        ].join('\n'),
      },
      {
        name: '📊 STATISTIK',
        value: [
          `🔐 Akun login: ${num(stats.logins)}`,
          `📱 Device: ${num(stats.devices)} (🟢 ${stats.active} · 🟡 ${stats.expiring} · 🔴 ${stats.expired})`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '✅ TUGAS SUKSES',
        value: [`🔄 Sinkron: ${num(stats.syncs)}`, `🎟️ Redeem: ${num(stats.redeems)}`, `🔋 Renew: ${num(stats.renews)}`, `🔁 Replace: ${num(stats.replaces)}`].join(
          '\n'
        ),
        inline: true,
      },
      {
        name: '⚠️ CATATAN PENTING',
        value: [
          '• Email & password disimpan **terenkripsi** dan tidak pernah ditampilkan di Discord.',
          '• Bot tidak melewati CAPTCHA/OTP. Jika Redfinger meminta verifikasi, admin akan diberi tahu.',
          '• Khusus admin Redfinger. Semua balasan hanya terlihat oleh Anda.',
        ].join('\n'),
      }
    )
    .setFooter({ text: 'Sultan Redfinger Manager' })
    .setTimestamp();

  const main = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CustomId.RF_PANEL_REGISTER).setLabel('Register').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CustomId.RF_PANEL_REDEEM).setLabel('Redeem').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CustomId.RF_PANEL_REPLACE).setLabel('Replace').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CustomId.RF_PANEL_RENEW).setLabel('Renew').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CustomId.RF_PANEL_LOGOUT).setLabel('Logout').setStyle(ButtonStyle.Danger)
  );
  const tools = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CustomId.RF_PANEL_LIST).setLabel('Daftar Device').setEmoji('📋').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(CustomId.RF_PANEL_MANAGE).setLabel('Kelola Device').setEmoji('🛠️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(CustomId.RF_PANEL_RETRY).setLabel('Retry Tasks').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CustomId.RF_PANEL_ADD).setLabel('Tambah Manual').setEmoji('➕').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CustomId.RF_PANEL_SETUP).setEmoji('⚙️').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [main, tools] };
}
