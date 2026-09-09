import { ModalSubmitInteraction } from 'discord.js';
import { CustomId, parseCustomId } from '../types/customIds';
import { setPendingRobuxUsername } from '../services/order/orderSession';
import { buildRobuxAmountSelect } from '../selectMenus/robuxAmountSelect';
import { calculateRobuxPrice, isAllowedRobuxAmount } from '../services/robux/robuxPricing';
import { getBotSetting } from '../database/prisma';
import { buildOrderConfirmView } from '../utils/orderConfirm';
import { baseEmbed, errorEmbed } from '../utils/embeds';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/; // aturan username Roblox standar

export async function handleRobloxUsernameSubmit(interaction: ModalSubmitInteraction) {
  const username = interaction.fields.getTextInputValue(CustomId.INPUT_ROBLOX_USERNAME).trim();

  if (!USERNAME_REGEX.test(username)) {
    await interaction.reply({
      embeds: [errorEmbed('Username Roblox tidak valid. Gunakan 3-20 karakter huruf, angka, atau underscore.')],
      ephemeral: true,
    });
    return;
  }

  setPendingRobuxUsername(interaction.user.id, username);

  // Alur panel: custom_id modal membawa jumlah robux (mis. "modal_roblox_username:500").
  // Jumlah sudah dipilih di panel, jadi langsung ke ringkasan harga + tombol konfirmasi.
  const { args } = parseCustomId(interaction.customId);
  const amountFromPanel = args[0] ? Number(args[0]) : null;

  if (amountFromPanel != null && isAllowedRobuxAmount(amountFromPanel)) {
    const setting = await getBotSetting();
    const price = calculateRobuxPrice(amountFromPanel, setting.robuxPricePerUnit);
    await interaction.reply({
      ...buildOrderConfirmView({ username, amount: amountFromPanel, price }),
      ephemeral: true,
    });
    return;
  }

  // Alur /buy biasa: jumlah belum dipilih, tampilkan pilihan jumlah Robux.
  const embed = baseEmbed()
    .setTitle('💰 Beli Robux')
    .setDescription(`Username Roblox: **${username}**\n\nPilih jumlah Robux yang ingin Anda beli.`);

  await interaction.reply({
    embeds: [embed],
    components: [buildRobuxAmountSelect()],
    ephemeral: true,
  });
}
