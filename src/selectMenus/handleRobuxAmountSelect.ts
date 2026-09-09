import { StringSelectMenuInteraction } from 'discord.js';
import { getPendingRobuxUsername } from '../services/order/orderSession';
import { calculateRobuxPrice, isValidRobuxAmount } from '../services/robux/robuxPricing';
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
  const price = calculateRobuxPrice(amount, setting.robuxPricePerUnit);

  await interaction.update(buildOrderConfirmView({ username, amount, price }));
}
