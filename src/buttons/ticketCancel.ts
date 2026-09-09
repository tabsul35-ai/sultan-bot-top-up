import { ButtonInteraction, GuildMember } from 'discord.js';
import { OrderStatus } from '@prisma/client';
import { getOrderById, cancelOrder } from '../services/order/orderService';
import { isStaffOrAdmin } from '../utils/permissions';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { logTransaction } from '../utils/logger';

export async function handleTicketCancel(interaction: ButtonInteraction, orderId: string) {
  const order = await getOrderById(orderId);
  if (!order) {
    await interaction.reply({ embeds: [errorEmbed('Order tidak ditemukan.')], ephemeral: true });
    return;
  }

  const isOwner = order.discordId === interaction.user.id;
  const staff = interaction.member instanceof GuildMember ? await isStaffOrAdmin(interaction.member) : false;

  if (!isOwner && !staff) {
    await interaction.reply({ embeds: [errorEmbed('Anda tidak memiliki izin untuk membatalkan order ini.')], ephemeral: true });
    return;
  }

  if (!([OrderStatus.PENDING, OrderStatus.WAITING_PAYMENT] as OrderStatus[]).includes(order.status)) {
    await interaction.reply({
      embeds: [errorEmbed(`Order dengan status **${order.status}** tidak dapat dibatalkan lagi.`)],
      ephemeral: true,
    });
    return;
  }

  await cancelOrder(order.id);

  await logTransaction(interaction.client, {
    orderId: order.id,
    type: 'ORDER_CANCELLED',
    title: '🛑 ORDER CANCELLED',
    message: `Order ${order.orderCode} dibatalkan oleh <@${interaction.user.id}>`,
    actorId: interaction.user.id,
  });

  await interaction.reply({ embeds: [successEmbed('Order dibatalkan. Ticket ini akan ditutup oleh staff.')] });
}
