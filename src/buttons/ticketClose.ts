import { ButtonInteraction, GuildMember, TextChannel } from 'discord.js';
import { isStaffOrAdmin } from '../utils/permissions';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { cancelOrder, getOrderById, isOrderActive } from '../services/order/orderService';
import { logTransaction } from '../utils/logger';

export async function handleTicketClose(interaction: ButtonInteraction, orderId: string) {
  if (!(interaction.member instanceof GuildMember) || !(await isStaffOrAdmin(interaction.member))) {
    await interaction.reply({ embeds: [errorEmbed('Hanya staff/admin yang dapat menutup ticket.')], ephemeral: true });
    return;
  }

  const order = await getOrderById(orderId);

  // Bebaskan order yang belum tuntas supaya customer bisa membuat order baru.
  // Order yang sudah COMPLETED/CANCELLED/REJECTED dibiarkan apa adanya.
  if (order && isOrderActive(order.status)) {
    await cancelOrder(order.id);
  }

  await interaction.reply({ embeds: [successEmbed('Ticket ini akan ditutup dalam 5 detik...')] });

  await logTransaction(interaction.client, {
    orderId: order?.id,
    type: 'TICKET_CLOSED',
    title: '🔒 TICKET CLOSED',
    message: `Ticket order ${order?.orderCode ?? orderId} ditutup oleh <@${interaction.user.id}>`,
    actorId: interaction.user.id,
  });

  setTimeout(async () => {
    const channel = interaction.channel;
    if (channel instanceof TextChannel) {
      await channel.delete().catch((err) => console.error('[ticketClose] Gagal menghapus channel:', err));
    }
  }, 5000);
}
