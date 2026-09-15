import { ModalSubmitInteraction, GuildMember } from 'discord.js';
import { CustomId } from '../types/customIds';
import { isAdmin } from '../utils/permissions';
import { prisma, getBotSetting } from '../database/prisma';
import { refreshRobuxStock } from '../services/roblox/stockPoller';
import { errorEmbed, successEmbed } from '../utils/embeds';

export async function handleRobloxCookieSubmit(interaction: ModalSubmitInteraction) {
  // Dobel cek admin (showModal-nya sendiri sudah di belakang /admin, ini jaga-jaga saja).
  if (!(interaction.member instanceof GuildMember) || !(await isAdmin(interaction.member))) {
    await interaction.reply({ embeds: [errorEmbed('Hanya admin yang dapat mengatur ini.')], ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const cookie = interaction.fields.getTextInputValue(CustomId.INPUT_ROBLOX_COOKIE).trim();
  if (cookie.length < 50) {
    await interaction.editReply({
      embeds: [errorEmbed('Nilai yang dimasukkan terlalu pendek untuk sebuah cookie Roblox. Pastikan Anda paste seluruh isi value `.ROBLOSECURITY`.')],
    });
    return;
  }

  await prisma.botSetting.upsert({
    where: { id: 1 },
    update: { robloxCookieOverride: cookie, robuxStockError: null },
    create: { id: 1, robloxCookieOverride: cookie },
  });

  const stock = await refreshRobuxStock(interaction.client);
  const setting = await getBotSetting();

  if (stock === null) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          `Cookie tersimpan, tapi gagal mengambil saldo Robux: ${setting.robuxStockError ?? 'error tidak diketahui'}.\n\nCek lagi apakah cookie sudah lengkap ter-copy dan belum kedaluwarsa, lalu jalankan \`/admin refreshstock\`.`
        ),
      ],
    });
    return;
  }

  await interaction.editReply({
    embeds: [successEmbed(`✅ Cookie tersimpan. Stok Robux live sekarang: **${stock.toLocaleString('id-ID')} Robux**.`)],
  });
}
