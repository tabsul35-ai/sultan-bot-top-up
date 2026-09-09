import { ButtonInteraction } from 'discord.js';
import { clearPendingRobuxOrder } from '../services/order/orderSession';
import { errorEmbed } from '../utils/embeds';

export async function handleOrderCancelPrecheckout(interaction: ButtonInteraction) {
  clearPendingRobuxOrder(interaction.user.id);
  await interaction.update({
    embeds: [errorEmbed('Pesanan dibatalkan.')],
    components: [],
  });
}
