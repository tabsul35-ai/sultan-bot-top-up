import { ModalSubmitInteraction } from 'discord.js';
import { CustomId } from '../types/customIds';
import { setPendingRobuxUsername } from '../services/order/orderSession';
import { getActiveOrderForUser } from '../services/order/orderService';
import {
  ROBUX_CUSTOM_MAX,
  ROBUX_CUSTOM_MIN,
  calculateRobuxPrice,
  isAllowedRobuxAmount,
} from '../services/robux/robuxPricing';
import { hasEnoughStock } from '../services/robux/robuxStock';
import { checkRobloxUsername } from '../services/roblox/robloxUsers';
import { getBotSetting } from '../database/prisma';
import { buildOrderConfirmView } from '../utils/orderConfirm';
import { errorEmbed } from '../utils/embeds';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/; // aturan username Roblox standar

export async function handleRobuxCustomSubmit(interaction: ModalSubmitInteraction) {
  const rawAmount = interaction.fields.getTextInputValue(CustomId.INPUT_ROBUX_AMOUNT).trim().replace(/[.,\s]/g, '');
  const rawUsername = interaction.fields.getTextInputValue(CustomId.INPUT_ROBLOX_USERNAME).trim();

  const amount = Number(rawAmount);
  if (!/^\d+$/.test(rawAmount) || !isAllowedRobuxAmount(amount)) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          `Jumlah Robux tidak valid. Masukkan angka bulat antara ${ROBUX_CUSTOM_MIN.toLocaleString('id-ID')} dan ${ROBUX_CUSTOM_MAX.toLocaleString('id-ID')}.`
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (!USERNAME_REGEX.test(rawUsername)) {
    await interaction.reply({
      embeds: [errorEmbed('Username Roblox tidak valid. Gunakan 3-20 karakter huruf, angka, atau underscore.')],
      ephemeral: true,
    });
    return;
  }

  // Pastikan akunnya benar-benar ada di Roblox - typo di sini berarti Robux salah/gagal kirim
  // nanti (pengiriman pakai username apa adanya). Kalau API Roblox lagi bermasalah, tidak diblokir.
  const usernameCheck = await checkRobloxUsername(rawUsername);
  if (usernameCheck.status === 'not_found') {
    await interaction.reply({
      embeds: [
        errorEmbed(
          `Username Roblox **${rawUsername}** tidak ditemukan di Roblox. Cek lagi ejaannya (buka roblox.com/users lalu cari nama itu) sebelum lanjut.`
        ),
      ],
      ephemeral: true,
    });
    return;
  }
  const username = usernameCheck.status === 'found' ? usernameCheck.name : rawUsername;

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

  const setting = await getBotSetting();

  if (!hasEnoughStock(amount, setting)) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          `Stok Robux saat ini tidak cukup untuk **${amount.toLocaleString('id-ID')} Robux** (tersisa **${(setting.robuxStockCache ?? 0).toLocaleString('id-ID')} Robux**). Pilih jumlah lebih kecil atau coba lagi nanti.`
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  setPendingRobuxUsername(interaction.user.id, username);

  const price = calculateRobuxPrice(amount, setting.robuxPricePerUnit);

  await interaction.reply({
    ...buildOrderConfirmView({ username, amount, price }),
    ephemeral: true,
  });
}
