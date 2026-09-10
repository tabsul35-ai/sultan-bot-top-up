import { ButtonInteraction, GuildMember } from 'discord.js';
import { OrderStatus } from '@prisma/client';
import { getOrderById, markCompleted } from '../services/order/orderService';
import { isStaffOrAdmin } from '../utils/permissions';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { logTransaction } from '../utils/logger';

export async function handleOrderMarkCompleted(interaction: ButtonInteraction, orderId: string) {
  if (!(interaction.member instanceof GuildMember) || !(await isStaffOrAdmin(interaction.member))) {
    await interaction.reply({ embeds: [errorEmbed('Hanya staff/admin yang dapat menandai order selesai.')], ephemeral: true });
    return;
  }

  const order = await getOrderById(orderId);
  if (!order) {
    await interaction.reply({ embeds: [errorEmbed('Order tidak ditemukan.')], ephemeral: true });
    return;
  }

  if (order.status !== OrderStatus.PAID && order.status !== OrderStatus.PROCESSING) {
    await interaction.reply({ embeds: [errorEmbed(`Order ini berstatus **${order.status}**, tidak bisa ditandai selesai.`)], ephemeral: true });
    return;
  }

  await markCompleted(order.id);

  await logTransaction(interaction.client, {
    orderId: order.id,
    type: 'ORDER_COMPLETED',
    title: '✅ ORDER COMPLETED',
    message: `Order ${order.orderCode} selesai. Robux dikirim oleh <@${interaction.user.id}>`,
    actorId: interaction.user.id,
  });

  await interaction.reply({
    embeds: [
      successEmbed(
        `Order **${order.orderCode}** selesai! ${order.robuxAmount} Robux telah dikirim ke **${order.robloxUsername}**.\n\nTerima kasih <@${order.discordId}> sudah berbelanja di Sultan Top Up 👑\n\nStaff dapat menutup ticket ini dengan tombol ✅ Selesai atau 🔒 Tutup Ticket.`
      ),
    ],
  });
}
