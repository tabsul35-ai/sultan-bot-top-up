import { ModalSubmitInteraction } from 'discord.js';
import { CustomId, parseCustomId } from '../types/customIds';
import { setPendingRobuxUsername } from '../services/order/orderSession';
import { buildRobuxAmountSelect } from '../selectMenus/robuxAmountSelect';
import { calculateRobuxPrice, isAllowedRobuxAmount } from '../services/robux/robuxPricing';
import { getBotSetting } from '../database/prisma';
import { getActiveOrderForUser } from '../services/order/orderService';
import { buildOrderConfirmView } from '../utils/orderConfirm';
import { baseEmbed, errorEmbed } from '../utils/embeds';
import { checkRobloxUsername } from '../services/roblox/robloxUsers';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/; // aturan username Roblox standar

export async function handleRobloxUsernameSubmit(interaction: ModalSubmitInteraction) {
  // Defer dulu: langkah berikutnya menyentuh database (getActiveOrderForUser, getBotSetting)
  // yang bisa lambat saat Neon cold-start. Tanpa defer, interaksi bisa kedaluwarsa (3 detik).
  await interaction.deferReply({ ephemeral: true });

  const rawUsername = interaction.fields.getTextInputValue(CustomId.INPUT_ROBLOX_USERNAME).trim();

  if (!USERNAME_REGEX.test(rawUsername)) {
    await interaction.editReply({
      embeds: [errorEmbed('Username Roblox tidak valid. Gunakan 3-20 karakter huruf, angka, atau underscore.')],
    });
    return;
  }

  // Pastikan akunnya benar-benar ada di Roblox - typo di sini berarti Robux salah/gagal kirim
  // nanti (pengiriman pakai username apa adanya). Kalau API Roblox lagi bermasalah, tidak diblokir.
  const usernameCheck = await checkRobloxUsername(rawUsername);
  if (usernameCheck.status === 'not_found') {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          `Username Roblox **${rawUsername}** tidak ditemukan di Roblox. Cek lagi ejaannya (buka roblox.com/users lalu cari nama itu) sebelum lanjut.`
        ),
      ],
    });
    return;
  }
  const username = usernameCheck.status === 'found' ? usernameCheck.name : rawUsername;

  // Anti-spam: satu order aktif per user. Dipindah ke sini dari handlePanelRobuxSelect
  // supaya pembukaan modal tidak tertahan query database.
  const activeOrder = await getActiveOrderForUser(interaction.user.id, interaction.guildId!);
  if (activeOrder) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          `Anda masih memiliki order aktif (**${activeOrder.orderCode}**). Selesaikan atau batalkan order tersebut terlebih dahulu.`
        ),
      ],
    });
    return;
  }

  setPendingRobuxUsername(interaction.guildId!, interaction.user.id, username);

  // Alur panel: custom_id modal membawa jumlah robux (mis. "modal_roblox_username:500").
  // Jumlah sudah dipilih di panel, jadi langsung ke ringkasan harga + tombol konfirmasi.
  const { args } = parseCustomId(interaction.customId);
  const amountFromPanel = args[0] ? Number(args[0]) : null;

  if (amountFromPanel != null && isAllowedRobuxAmount(amountFromPanel)) {
    const setting = await getBotSetting(interaction.guildId!);
    const price = calculateRobuxPrice(amountFromPanel, setting.robuxPricePerUnit);
    await interaction.editReply(buildOrderConfirmView({ username, amount: amountFromPanel, price }));
    return;
  }

  // Alur /buy biasa: jumlah belum dipilih, tampilkan pilihan jumlah Robux.
  const embed = baseEmbed()
    .setTitle('💰 Beli Robux')
    .setDescription(`Username Roblox: **${username}**\n\nPilih jumlah Robux yang ingin Anda beli.`);

  await interaction.editReply({
    embeds: [embed],
    components: [buildRobuxAmountSelect()],
  });
}
