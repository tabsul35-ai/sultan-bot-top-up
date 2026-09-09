import { ChatInputCommandInteraction, GuildMember, SlashCommandBuilder, TextChannel } from 'discord.js';
import { getBotSetting, prisma } from '../database/prisma';
import { isAdmin } from '../utils/permissions';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { VERIFY_PANEL_TITLE, buildVerifyPanel } from '../panels/verifyPanel';
import { tidyPanelChannel } from '../utils/channelPanel';

export const data = new SlashCommandBuilder()
  .setName('setup-verify')
  .setDescription('Pasang panel verifikasi member di channel ini (admin)')
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
    await interaction.reply({ embeds: [errorEmbed('Jalankan command ini di dalam channel teks biasa.')], ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const setting = await getBotSetting();
  const bersihkan = interaction.options.getBoolean('bersihkan') ?? false;
  const catatan = await tidyPanelChannel(channel, {
    botId: interaction.client.user.id,
    panelTitle: VERIFY_PANEL_TITLE,
    bersihkan,
  });

  await channel.send(buildVerifyPanel());

  // Ingat channel ini supaya /lockdown membiarkannya tetap publik.
  await prisma.botSetting.upsert({
    where: { id: 1 },
    update: { verifyChannelId: channel.id },
    create: { id: 1, verifyChannelId: channel.id },
  });

  const roleWarn = setting.verifiedRoleId
    ? ''
    : '\n\n⚠️ Role verifikasi belum diatur. Jalankan `/admin setroles verified:@Role` supaya tombolnya berfungsi.';

  await interaction.editReply({
    embeds: [successEmbed('Panel verifikasi dipasang di channel ini.' + catatan + roleWarn)],
  });
}
