import { ButtonInteraction, GuildMember } from 'discord.js';
import { OrderStatus } from '@prisma/client';
import { getOrderById, rejectPayment } from '../services/order/orderService';
import { isStaffOrAdmin } from '../utils/permissions';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { logTransaction } from '../utils/logger';

export async function handlePaymentReject(interaction: ButtonInteraction, orderId: string) {
  if (!(interaction.member instanceof GuildMember) || !(await isStaffOrAdmin(interaction.member))) {
    await interaction.reply({ embeds: [errorEmbed('Hanya staff/admin yang dapat menolak pembayaran.')], ephemeral: true });
    return;
  }

  const order = await getOrderById(orderId);
  if (!order) {
    await interaction.reply({ embeds: [errorEmbed('Order tidak ditemukan.')], ephemeral: true });
    return;
  }

  if (order.status !== OrderStatus.WAITING_PAYMENT) {
    await interaction.reply({ embeds: [errorEmbed(`Order ini berstatus **${order.status}**, tidak bisa ditolak.`)], ephemeral: true });
    return;
  }

  await rejectPayment(order.id, interaction.user.id, 'Bukti pembayaran tidak valid/tidak sesuai.');

  await logTransaction(interaction.client, {
    orderId: order.id,
    type: 'PAYMENT_REJECTED',
    title: '❌ PAYMENT REJECTED',
    message: `Bukti pembayaran order ${order.orderCode} ditolak oleh <@${interaction.user.id}>`,
    actorId: interaction.user.id,
  });

  await interaction.reply({
    embeds: [
      successEmbed(
        `Bukti pembayaran order **${order.orderCode}** ditolak oleh <@${interaction.user.id}>. Silakan <@${order.discordId}> upload ulang bukti pembayaran yang valid.`
      ),
    ],
  });
}
