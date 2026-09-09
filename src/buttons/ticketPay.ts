import { ButtonInteraction } from 'discord.js';
import { getOrderById } from '../services/order/orderService';
import { buildPaymentEmbed } from '../services/payment/paymentService';
import { errorEmbed } from '../utils/embeds';

export async function handleTicketPay(interaction: ButtonInteraction, orderId: string) {
  const order = await getOrderById(orderId);
  if (!order) {
    await interaction.reply({ embeds: [errorEmbed('Order tidak ditemukan.')], ephemeral: true });
    return;
  }

  const { embed, components } = await buildPaymentEmbed(order);
  await interaction.reply({ embeds: [embed], components });
}
