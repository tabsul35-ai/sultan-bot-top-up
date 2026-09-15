import { StringSelectMenuInteraction } from 'discord.js';
import { getPendingRobuxUsername } from '../services/order/orderSession';
import { calculateRobuxPrice, isValidRobuxAmount } from '../services/robux/robuxPricing';
import { hasEnoughStock } from '../services/robux/robuxStock';
import { getBotSetting } from '../database/prisma';
import { buildOrderConfirmView } from '../utils/orderConfirm';
import { errorEmbed } from '../utils/embeds';

export async function handleRobuxAmountSelect(interaction: StringSelectMenuInteraction) {
  const username = getPendingRobuxUsername(interaction.user.id);
  if (!username) {
    await interaction.update({
      embeds: [errorEmbed('Sesi Anda sudah kedaluwarsa. Silakan mulai lagi dengan `/buy`.')],
      components: [],
    });
    return;
  }

  const amount = Number(interaction.values[0]);
  if (!isValidRobuxAmount(amount)) {
    await interaction.update({ embeds: [errorEmbed('Jumlah Robux tidak valid.')], components: [] });
    return;
  }

  const setting = await getBotSetting();

  if (!hasEnoughStock(amount, setting)) {
    await interaction.update({
      embeds: [
        errorEmbed(
          `Stok Robux saat ini tidak cukup untuk **${amount.toLocaleString('id-ID')} Robux** (tersisa **${(setting.robuxStockCache ?? 0).toLocaleString('id-ID')} Robux**). Pilih jumlah lebih kecil atau coba lagi nanti.`
        ),
      ],
      components: [],
    });
    return;
  }

  const price = calculateRobuxPrice(amount, setting.robuxPricePerUnit);

  await interaction.update(buildOrderConfirmView({ username, amount, price }));
}
