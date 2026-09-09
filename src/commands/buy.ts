import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { baseEmbed } from '../utils/embeds';
import { CustomId } from '../types/customIds';

export const data = new SlashCommandBuilder()
  .setName('buy')
  .setDescription('Buka menu pembelian Sultan Top Up');

export async function execute(interaction: ChatInputCommandInteraction) {
  const embed = baseEmbed()
    .setTitle('🛒 Sultan Top Up')
    .setDescription('Pilih produk yang ingin Anda beli.');

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CustomId.BUY_ROBUX).setLabel('Beli Robux').setEmoji('💰').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CustomId.BUY_KOSTUM).setLabel('Beli Kostum').setEmoji('👕').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CustomId.BUY_REKBER).setLabel('Rekber').setEmoji('🤝').setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CustomId.BUY_HISTORY).setLabel('Riwayat Transaksi').setEmoji('📋').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CustomId.BUY_HELP).setLabel('Bantuan').setEmoji('❓').setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({ embeds: [embed], components: [row1, row2] });
}
