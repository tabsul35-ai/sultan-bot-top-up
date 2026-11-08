import { ButtonInteraction, GuildMember, TextChannel } from 'discord.js';
import { OrderStatus } from '@prisma/client';
import { isStaffOrAdmin } from '../utils/permissions';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { getOrderById, markCompleted } from '../services/order/orderService';
import { logTransaction } from '../utils/logger';

/**
 * Tombol "Selesai" di panel ticket: staff menandai pesanan sudah beres
 * (status -> COMPLETED) lalu ticket ditutup otomatis beberapa detik kemudian.
 *
 * Bedanya dengan "Robux Terkirim" (ORDER_MARK_COMPLETED): tombol ini sekaligus
 * menutup ticket, jadi staff tidak perlu menekan "Tutup Ticket" lagi.
 */
export async function handleTicketDone(interaction: ButtonInteraction, orderId: string) {
  if (!(interaction.member instanceof GuildMember) || !(await isStaffOrAdmin(interaction.member))) {
    await interaction.reply({ embeds: [errorEmbed('Hanya staff/admin yang dapat menyelesaikan ticket.')], ephemeral: true });
    return;
  }

  const order = await getOrderById(orderId);
  if (!order) {
    await interaction.reply({ embeds: [errorEmbed('Order tidak ditemukan.')], ephemeral: true });
    return;
  }

  const alreadyCompleted = order.status === OrderStatus.COMPLETED;

  // Hanya boleh diselesaikan kalau pembayaran sudah diverifikasi (PAID/PROCESSING),
  // atau memang sudah COMPLETED (tinggal ditutup).
  if (!alreadyCompleted && order.status !== OrderStatus.PAID && order.status !== OrderStatus.PROCESSING) {
    await interaction.reply({
      embeds: [errorEmbed(`Order ini berstatus **${order.status}**, belum bisa diselesaikan. Verifikasi pembayaran dulu.`)],
      ephemeral: true,
    });
    return;
  }

  if (!alreadyCompleted) {
    await markCompleted(order.id);

    await logTransaction(interaction.client, {
      guildId: order.guildId,
      orderId: order.id,
      type: 'ORDER_COMPLETED',
      title: '✅ ORDER COMPLETED',
      message: `Order ${order.orderCode} ditandai selesai oleh <@${interaction.user.id}>`,
      actorId: interaction.user.id,
    });
  }

  await logTransaction(interaction.client, {
    guildId: order.guildId,
    orderId: order.id,
    type: 'TICKET_CLOSED',
    title: '🔒 TICKET CLOSED',
    message: `Ticket order ${order.orderCode} ditutup (selesai) oleh <@${interaction.user.id}>`,
    actorId: interaction.user.id,
  });

  await interaction.reply({
    embeds: [
      successEmbed(
        `Pesanan **${order.orderCode}** selesai! Terima kasih <@${order.discordId}> sudah berbelanja di Sultan Top Up 👑\n\nTicket ini akan ditutup dalam 5 detik...`
      ),
    ],
  });

  setTimeout(async () => {
    const channel = interaction.channel;
    if (channel instanceof TextChannel) {
      await channel.delete().catch((err) => console.error('[ticketDone] Gagal menghapus channel:', err));
    }
  }, 5000);
}
