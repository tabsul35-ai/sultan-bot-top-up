import { ButtonInteraction } from 'discord.js';
import { getBotSetting } from '../database/prisma';
import { successEmbed } from '../utils/embeds';

export async function handleTicketCallStaff(interaction: ButtonInteraction) {
  const setting = await getBotSetting();
  const mention = setting.staffRoleId ? `<@&${setting.staffRoleId}>` : 'Staff';

  await interaction.reply({
    content: `${mention}`,
    embeds: [successEmbed(`<@${interaction.user.id}> memanggil staff untuk membantu ticket ini.`)],
  });
}
