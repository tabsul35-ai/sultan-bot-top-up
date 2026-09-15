import { ModalSubmitInteraction, GuildMember } from 'discord.js';
import { CustomId } from '../types/customIds';
import { isAdmin } from '../utils/permissions';
import { prisma } from '../database/prisma';
import { refreshRobuxStock, MAX_ROBLOX_ACCOUNTS } from '../services/roblox/stockPoller';
import { errorEmbed, successEmbed } from '../utils/embeds';

export async function handleRobloxAccountSubmit(interaction: ModalSubmitInteraction) {
  // Dobel cek admin (showModal-nya sendiri sudah di belakang /admin, ini jaga-jaga saja).
  if (!(interaction.member instanceof GuildMember) || !(await isAdmin(interaction.member))) {
    await interaction.reply({ embeds: [errorEmbed('Hanya admin yang dapat mengatur ini.')], ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const label = interaction.fields.getTextInputValue(CustomId.INPUT_ROBLOX_ACCOUNT_LABEL).trim();
  const cookie = interaction.fields.getTextInputValue(CustomId.INPUT_ROBLOX_COOKIE).trim();

  if (cookie.length < 50) {
    await interaction.editReply({
      embeds: [errorEmbed('Nilai cookie terlalu pendek untuk sebuah cookie Roblox. Pastikan Anda paste seluruh isi value `.ROBLOSECURITY`.')],
    });
    return;
  }

  const activeCount = await prisma.robloxAccount.count({ where: { active: true } });
  if (activeCount >= MAX_ROBLOX_ACCOUNTS) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          `Sudah ada ${activeCount} akun aktif (maksimal ${MAX_ROBLOX_ACCOUNTS}). Hapus salah satu dulu lewat \`/admin removerobloxaccount\` sebelum menambah yang baru.`
        ),
      ],
    });
    return;
  }

  const existing = await prisma.robloxAccount.findFirst({ where: { label: { equals: label, mode: 'insensitive' } } });
  if (existing) {
    await interaction.editReply({ embeds: [errorEmbed(`Nama akun "${label}" sudah dipakai. Pakai nama lain yang belum ada.`)] });
    return;
  }

  const account = await prisma.robloxAccount.create({ data: { label, cookie } });

  const total = await refreshRobuxStock(interaction.client);
  const refreshed = await prisma.robloxAccount.findUnique({ where: { id: account.id } });

  if (refreshed?.stockError) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          `Akun **${label}** tersimpan, tapi gagal mengambil saldo: ${refreshed.stockError}.\n\nCek lagi apakah cookie sudah lengkap ter-copy dan belum kedaluwarsa, lalu jalankan \`/admin refreshstock\`.`
        ),
      ],
    });
    return;
  }

  await interaction.editReply({
    embeds: [
      successEmbed(
        `✅ Akun **${label}** ditambahkan. Saldo akun ini: **${(refreshed?.stockCache ?? 0).toLocaleString('id-ID')} Robux**.\n\nTotal stok gabungan sekarang: **${(total ?? 0).toLocaleString('id-ID')} Robux**.`
      ),
    ],
  });
}
