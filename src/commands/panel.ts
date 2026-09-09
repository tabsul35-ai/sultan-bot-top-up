import { ChatInputCommandInteraction, GuildMember, SlashCommandBuilder, TextChannel } from 'discord.js';
import { getBotSetting } from '../database/prisma';
import { isAdmin } from '../utils/permissions';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { PANEL_ROBUX_TITLE, buildRobuxPanel } from '../panels/robuxPanel';
import { tidyPanelChannel } from '../utils/channelPanel';

export const data = new SlashCommandBuilder()
  .setName('panel')
  .setDescription('Pasang panel pembelian Robux permanen di channel ini (admin)')
  .addBooleanOption((opt) =>
    opt
      .setName('bersihkan')
      .setDescription('Hapus semua pesan lain di channel ini lebih dulu (maks 100, umur < 14 hari)')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!(interaction.member instanceof GuildMember) || !(await isAdmin(interaction.member))) {
    await interaction.reply({ embeds: [errorEmbed('Command ini hanya untuk admin.')], ephemeral: true });
    return;
  }

  const channel = interaction.channel;
  if (!(channel instanceof TextChannel)) {
    await interaction.reply({
      embeds: [errorEmbed('Jalankan command ini di dalam channel teks biasa.')],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const bersihkan = interaction.options.getBoolean('bersihkan') ?? false;
  const catatan = await tidyPanelChannel(channel, {
    botId: interaction.client.user.id,
    panelTitle: PANEL_ROBUX_TITLE,
    bersihkan,
  });

  const setting = await getBotSetting();
  await channel.send(buildRobuxPanel(setting.robuxPricePerUnit));

  await interaction.editReply({
    embeds: [successEmbed('Panel pembelian Robux dipasang di channel ini.' + catatan)],
  });
}
