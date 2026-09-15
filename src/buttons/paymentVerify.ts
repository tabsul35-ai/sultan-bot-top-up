import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction, GuildMember } from 'discord.js';
import { OrderStatus, ProductType } from '@prisma/client';
import { getOrderById, verifyPayment } from '../services/order/orderService';
import { isStaffOrAdmin } from '../utils/permissions';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { logTransaction } from '../utils/logger';
import { CustomId, buildCustomId } from '../types/customIds';
import { refreshRobuxStock } from '../services/roblox/stockPoller';

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

  // Cek ulang stok live (bukan cache) sekarang - paling akurat sesaat sebelum staff kirim manual.
  // Dijalankan setelah reply supaya tidak menunda ack interaksi (batas 3 detik Discord).
  if (order.productType === ProductType.ROBUX && order.robuxAmount) {
    const liveStock = await refreshRobuxStock(interaction.client).catch(() => null);
    if (liveStock !== null && order.robuxAmount > liveStock) {
      await interaction.followUp({
        embeds: [
          errorEmbed(
            `⚠️ Stok Robux saat ini hanya tersisa **${liveStock.toLocaleString('id-ID')}**, sedangkan order ini butuh **${order.robuxAmount.toLocaleString('id-ID')}**. Pastikan saldo cukup sebelum mengirim manual.`
          ),
        ],
      });
    }
  }
}
