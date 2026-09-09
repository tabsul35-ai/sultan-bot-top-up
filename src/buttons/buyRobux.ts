import { ButtonInteraction } from 'discord.js';
import { buildRobloxUsernameModal } from '../modals/robloxUsernameModal';
import { getActiveOrderForUser } from '../services/order/orderService';
import { errorEmbed } from '../utils/embeds';

export async function handleBuyRobux(interaction: ButtonInteraction) {
  // Anti-spam: cek apakah user sudah punya order aktif
  const activeOrder = await getActiveOrderForUser(interaction.user.id);
  if (activeOrder) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          `Anda masih memiliki order aktif (**${activeOrder.orderCode}**). Selesaikan atau batalkan order tersebut terlebih dahulu.`
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  await interaction.showModal(buildRobloxUsernameModal());
}
