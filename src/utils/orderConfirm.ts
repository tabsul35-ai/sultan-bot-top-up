import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { formatRupiah } from '../services/robux/robuxPricing';
import { baseEmbed } from './embeds';
import { CustomId } from '../types/customIds';

/**
 * Ringkasan pesanan + tombol Lanjutkan/Batalkan.
 * Dipakai bersama oleh alur /buy (setelah pilih jumlah) dan alur panel (setelah isi username),
 * supaya tampilan & custom_id tombol konfirmasi tidak pernah beda antar-alur.
 *
 * Jumlah & harga disisipkan di custom_id tombol Lanjutkan sehingga step berikutnya
 * (handleOrderConfirm) tidak butuh session tambahan.
 */
export function buildOrderConfirmView(params: { username: string; amount: number; price: number }) {
  const { username, amount, price } = params;

  const embed = baseEmbed()
    .setTitle('🛒 Detail Pesanan')
    .addFields(
      { name: '👤 Roblox Username', value: username, inline: true },
      { name: '💰 Robux', value: amount.toLocaleString('id-ID'), inline: true },
      { name: '💵 Harga', value: formatRupiah(price), inline: true }
    )
    .setDescription('Apakah Anda ingin melanjutkan?');

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CustomId.ORDER_CONFIRM}:${amount}:${price}`)
      .setLabel('Lanjutkan')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(CustomId.ORDER_CANCEL_PRECHECKOUT)
      .setLabel('Batalkan')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}
