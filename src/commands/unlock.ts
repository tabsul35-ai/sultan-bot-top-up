import { ChatInputCommandInteraction, GuildMember, SlashCommandBuilder } from 'discord.js';
import { isAdmin } from '../utils/permissions';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { unlockGuild } from '../utils/channelLock';

export const data = new SlashCommandBuilder()
  .setName('unlock')
  .setDescription('Batalkan lockdown - semua channel kembali terlihat oleh @everyone (admin)');

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!(interaction.member instanceof GuildMember) || !(await isAdmin(interaction.member))) {
    await interaction.reply({ embeds: [errorEmbed('Command ini hanya untuk admin.')], ephemeral: true });
    return;
  }
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ embeds: [errorEmbed('Hanya bisa dijalankan di dalam server.')], ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const r = await unlockGuild(interaction.guild);
  if (r.note) {
    await interaction.editReply({ embeds: [errorEmbed(r.note)] });
    return;
  }

  await interaction.editReply({
    embeds: [
      successEmbed(
        `Lockdown dibatalkan.\n• Channel dikembalikan: **${r.changed}**\n• Gagal: **${r.failed}**\n\n` +
          'Catatan: izin khusus role verifikasi/staff yang sempat ditambahkan tetap ada (tidak mengganggu), ' +
          'hapus manual bila mau benar-benar bersih.'
      ),
    ],
  });
}
