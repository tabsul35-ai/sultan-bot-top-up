import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { getUserOrderHistory } from '../services/order/orderService';
import { baseEmbed, errorEmbed } from '../utils/embeds';
import { formatRupiah } from '../services/robux/robuxPricing';

export const data = new SlashCommandBuilder()
  .setName('history')
  .setDescription('Lihat riwayat transaksi Anda');

export async function execute(interaction: ChatInputCommandInteraction) {
  const orders = await getUserOrderHistory(interaction.user.id);

  if (orders.length === 0) {
    await interaction.reply({ embeds: [errorEmbed('Anda belum memiliki riwayat transaksi.')], ephemeral: true });
    return;
  }

  const embed = baseEmbed()
    .setTitle('📋 Riwayat Transaksi')
    .setDescription(
      orders
        .map(
          (o) =>
            `**${o.orderCode}** — ${o.robuxAmount ?? '-'} Robux — ${formatRupiah(o.price)} — \`${o.status}\` — <t:${Math.floor(
              o.createdAt.getTime() / 1000
            )}:d>`
        )
        .join('\n')
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
