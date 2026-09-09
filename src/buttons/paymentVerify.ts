import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction, GuildMember } from 'discord.js';
import { OrderStatus } from '@prisma/client';
import { getOrderById, verifyPayment } from '../services/order/orderService';
import { isStaffOrAdmin } from '../utils/permissions';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { logTransaction } from '../utils/logger';
import { CustomId, buildCustomId } from '../types/customIds';

export async function handlePaymentVerify(interaction: ButtonInteraction, orderId: string) {
  if (!(interaction.member instanceof GuildMember) || !(await isStaffOrAdmin(interaction.member))) {
    await interaction.reply({ embeds: [errorEmbed('Hanya staff/admin yang dapat memverifikasi pembayaran.')], ephemeral: true });
    return;
  }

  const order = await getOrderById(orderId);
  if (!order) {
    await interaction.reply({ embeds: [errorEmbed('Order tidak ditemukan.')], ephemeral: true });
    return;
  }

  if (order.status !== OrderStatus.WAITING_PAYMENT) {
    await interaction.reply({ embeds: [errorEmbed(`Order ini berstatus **${order.status}**, tidak bisa diverifikasi lagi.`)], ephemeral: true });
    return;
  }

  await verifyPayment(order.id, interaction.user.id);

  await logTransaction(interaction.client, {
    orderId: order.id,
    type: 'PAYMENT_VERIFIED',
    title: '💳 PAYMENT VERIFIED',
    message: `Pembayaran order ${order.orderCode} diverifikasi oleh <@${interaction.user.id}>`,
    actorId: interaction.user.id,
  });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId(CustomId.ORDER_MARK_COMPLETED, order.id))
      .setLabel('Robux Terkirim')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
  );

  await interaction.reply({
    embeds: [
      successEmbed(
        `Pembayaran order **${order.orderCode}** diverifikasi oleh <@${interaction.user.id}>. Pesanan akan segera diproses.\n\nSilakan kirim ${order.robuxAmount} Robux ke username **${order.robloxUsername}** secara manual, lalu tekan tombol di bawah setelah selesai.`
      ),
    ],
    components: [row],
  });
}
