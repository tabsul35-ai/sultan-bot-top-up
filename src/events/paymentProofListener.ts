import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Message } from 'discord.js';
import { OrderStatus } from '@prisma/client';
import { getOrderByTicketChannel, setPaymentProof } from '../services/order/orderService';
import { baseEmbed } from '../utils/embeds';
import { CustomId, buildCustomId } from '../types/customIds';

/**
 * Dipanggil setiap ada pesan baru. Jika pesan berasal dari pemilik order, ada attachment gambar,
 * dan order sedang berstatus WAITING_PAYMENT, anggap itu bukti pembayaran:
 * simpan URL-nya dan tampilkan tombol verifikasi untuk staff.
 */
export async function handlePossiblePaymentProof(message: Message) {
  if (message.author.bot || !message.guild) return;
  if (message.attachments.size === 0) return;

  const order = await getOrderByTicketChannel(message.channelId);
  if (!order) return;
  if (order.discordId !== message.author.id) return; // hanya bukti dari pemilik order yang dianggap valid
  if (order.status !== OrderStatus.WAITING_PAYMENT) return;

  const imageAttachment = message.attachments.find((a) => a.contentType?.startsWith('image/'));
  if (!imageAttachment) return;

  await setPaymentProof(order.id, imageAttachment.url);

  const embed = baseEmbed()
    .setTitle('📤 Bukti Pembayaran Diterima')
    .setDescription(
      `Bukti pembayaran untuk order **${order.orderCode}** telah diterima. Menunggu verifikasi staff.`
    )
    .setImage(imageAttachment.url);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId(CustomId.PAYMENT_VERIFY, order.id))
      .setLabel('Pembayaran Valid')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(buildCustomId(CustomId.PAYMENT_REJECT, order.id))
      .setLabel('Pembayaran Ditolak')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );

  await message.reply({ embeds: [embed], components: [row] });
}
