import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../utils/embeds';

export const data = new SlashCommandBuilder().setName('ping').setDescription('Cek apakah bot aktif');

export async function execute(interaction: ChatInputCommandInteraction) {
  const sent = Date.now();
  await interaction.reply({ embeds: [successEmbed('Pong!')] });
  const latency = Date.now() - sent;
  await interaction.editReply({ embeds: [successEmbed(`Pong! Latency: ${latency}ms | WS: ${interaction.client.ws.ping}ms`)] });
}
