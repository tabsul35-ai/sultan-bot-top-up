import { ButtonInteraction, PermissionFlagsBits } from 'discord.js';
import { getBotSetting } from '../database/prisma';
import { errorEmbed, successEmbed } from '../utils/embeds';

export async function handleVerify(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ embeds: [errorEmbed('Verifikasi hanya bisa dilakukan di dalam server.')], ephemeral: true });
    return;
  }

  const setting = await getBotSetting();
  if (!setting.verifiedRoleId) {
    await interaction.reply({
      embeds: [errorEmbed('Role verifikasi belum diatur admin. Silakan hubungi staff.')],
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member;

  if (member.roles.cache.has(setting.verifiedRoleId)) {
    await interaction.reply({
      embeds: [successEmbed('Anda sudah terverifikasi. Selamat menikmati server! 🎉')],
      ephemeral: true,
    });
    return;
  }

  const role =
    interaction.guild.roles.cache.get(setting.verifiedRoleId) ??
    (await interaction.guild.roles.fetch(setting.verifiedRoleId).catch(() => null));

  if (!role) {
    await interaction.reply({
      embeds: [errorEmbed('Role verifikasi tidak ditemukan (mungkin sudah dihapus). Hubungi admin.')],
      ephemeral: true,
    });
    return;
  }

  const me = interaction.guild.members.me;
  if (!me || !me.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= me.roles.highest.position) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          'Bot tidak bisa memberi role ini. Admin: pastikan bot punya izin **Manage Roles** dan posisi role bot berada **di atas** role verifikasi di Server Settings > Roles.'
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  try {
    await member.roles.add(role, 'Verifikasi member lewat tombol');
    await interaction.reply({
      embeds: [successEmbed('Verifikasi berhasil! Akses ke server terbuka. Selamat datang 👑')],
      ephemeral: true,
    });
  } catch (err) {
    console.error('[handleVerify] Gagal menambah role:', err);
    await interaction.reply({
      embeds: [errorEmbed('Gagal menambah role verifikasi. Silakan hubungi admin.')],
      ephemeral: true,
    });
  }
}
