import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { getOrderByTicketChannel } from '../services/order/orderService';
import { buildPaymentEmbed } from '../services/payment/paymentService';
import { errorEmbed } from '../utils/embeds';

export const data = new SlashCommandBuilder()
  .setName('pay')
  .setDescription('Tampilkan info pembayaran untuk order di ticket ini');

export async function execute(interaction: ChatInputCommandInteraction) {
  // /pay hanya berlaku di dalam channel ticket yang terhubung ke sebuah order
  const order = await getOrderByTicketChannel(interaction.channelId);

  if (!order) {
    await interaction.reply({
      embeds: [errorEmbed('Command ini hanya bisa digunakan di dalam channel ticket order.')],
      ephemeral: true,
    });
    return;
  }

  const { embed, components } = await buildPaymentEmbed(order);
  await interaction.reply({ embeds: [embed], components });
}
