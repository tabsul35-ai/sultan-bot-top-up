import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { getBotSetting, prisma } from '../database/prisma';
import { BRAND } from '../config/config';

/**
 * Catat transaksi ke database (TransactionLog) dan kirim embed ke log channel jika sudah dikonfigurasi.
 * `guildId` menentukan server (toko) mana yang log channel-nya dipakai - tiap server punya
 * log channel sendiri-sendiri.
 */
export async function logTransaction(
  client: Client,
  params: {
    guildId: string;
    orderId?: string;
    type: string;
    title: string;
    message: string;
    actorId?: string;
    fields?: { name: string; value: string; inline?: boolean }[];
  }
) {
  // Simpan ke database dulu - ini yang paling penting, jangan sampai gagal karena masalah Discord API
  await prisma.transactionLog.create({
    data: {
      guildId: params.guildId,
      orderId: params.orderId,
      type: params.type,
      message: params.message,
      actorId: params.actorId,
    },
  });

  try {
    const setting = await getBotSetting(params.guildId);
    if (!setting.logChannelId) return;

    const channel = await client.channels.fetch(setting.logChannelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) return;

    const embed = new EmbedBuilder()
      .setColor(BRAND.color)
      .setTitle(params.title)
      .setDescription(params.message)
      .setTimestamp();

    if (params.fields?.length) {
      embed.addFields(params.fields);
    }

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('[logger] Gagal mengirim log ke channel:', err);
  }
}
