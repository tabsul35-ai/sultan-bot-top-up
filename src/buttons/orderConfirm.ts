import { ButtonInteraction } from 'discord.js';
import { clearPendingRobuxOrder, getPendingRobuxUsername } from '../services/order/orderSession';
import { createRobuxOrder, attachTicketChannel, cancelOrder, getActiveOrderForUser } from '../services/order/orderService';
import { createRobuxTicket } from '../services/ticket/ticketService';
import { formatRupiah, isAllowedRobuxAmount } from '../services/robux/robuxPricing';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { logTransaction } from '../utils/logger';

export async function handleOrderConfirm(interaction: ButtonInteraction, args: string[]) {
  const [amountStr, priceStr] = args;
  const amount = Number(amountStr);
  const price = Number(priceStr);

  if (!isAllowedRobuxAmount(amount) || !Number.isFinite(price) || price <= 0) {
    await interaction.update({ embeds: [errorEmbed('Data pesanan tidak valid, silakan mulai ulang dengan `/buy`.')], components: [] });
    return;
  }

  const username = getPendingRobuxUsername(interaction.user.id);
  if (!username) {
    await interaction.update({ embeds: [errorEmbed('Sesi Anda sudah kedaluwarsa. Silakan mulai lagi dengan `/buy`.')], components: [] });
    return;
  }

  if (!interaction.guild) {
    await interaction.update({ embeds: [errorEmbed('Command ini hanya bisa digunakan di dalam server.')], components: [] });
    return;
  }

  // Double-check anti-spam di titik akhir sebelum benar-benar membuat order
  const activeOrder = await getActiveOrderForUser(interaction.user.id);
  if (activeOrder) {
    await interaction.update({
      embeds: [errorEmbed(`Anda masih memiliki order aktif (**${activeOrder.orderCode}**).`)],
      components: [],
    });
    return;
  }

  await interaction.update({ embeds: [successEmbed('Memproses pesanan Anda...')], components: [] });

  const order = await createRobuxOrder({
    discordId: interaction.user.id,
    robloxUsername: username,
    robuxAmount: amount,
    price,
  });

  // Kalau pembuatan channel ticket gagal total, batalkan lagi order-nya supaya
  // customer tidak "terkunci" dengan order aktif yang tidak punya ticket.
  let channel;
  try {
    channel = await createRobuxTicket(interaction.guild, order, username);
    await attachTicketChannel(order.id, channel.id);
  } catch (err) {
    console.error('[handleOrderConfirm] Gagal membuat ticket, order dibatalkan otomatis:', err);
    await cancelOrder(order.id).catch(() => {});
    await interaction.followUp({
      embeds: [
        errorEmbed(
          'Gagal membuat channel ticket. Order otomatis dibatalkan - silakan coba lagi. Jika terus gagal, cek izin bot (Manage Channels) atau hubungi admin.'
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  clearPendingRobuxOrder(interaction.user.id);

  await logTransaction(interaction.client, {
    orderId: order.id,
    type: 'NEW_ORDER',
    title: '🛒 NEW ORDER',
    message: `Order baru dibuat oleh <@${interaction.user.id}>`,
    actorId: interaction.user.id,
    fields: [
      { name: 'Order ID', value: order.orderCode, inline: true },
      { name: 'Produk', value: `${amount.toLocaleString('id-ID')} Robux`, inline: true },
      { name: 'Harga', value: formatRupiah(price), inline: true },
    ],
  });

  await interaction.followUp({
    embeds: [successEmbed(`Ticket order Anda telah dibuat: ${channel}`)],
    ephemeral: true,
  });
}
