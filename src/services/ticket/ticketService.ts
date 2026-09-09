import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Guild,
  OverwriteResolvable,
  PermissionFlagsBits,
} from 'discord.js';
import { Order } from '@prisma/client';
import { getBotSetting } from '../../database/prisma';
import { sanitizeChannelName } from '../../utils/ids';
import { baseEmbed } from '../../utils/embeds';
import { formatRupiah } from '../robux/robuxPricing';
import { buildPaymentEmbed } from '../payment/paymentService';
import { CustomId, buildCustomId } from '../../types/customIds';

/**
 * Membuat ticket channel untuk order Robux, dengan permission:
 * - @everyone: tidak bisa lihat
 * - Customer: bisa lihat & kirim pesan
 * - Staff role & Admin role (jika dikonfigurasi): bisa lihat & kirim pesan
 */
export async function createRobuxTicket(guild: Guild, order: Order, robloxUsername: string) {
  const setting = await getBotSetting();

  const overwrites: OverwriteResolvable[] = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: order.discordId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles],
    },
  ];

  if (setting.staffRoleId) {
    overwrites.push({
      id: setting.staffRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles],
    });
  }
  if (setting.adminRoleId) {
    overwrites.push({
      id: setting.adminRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles],
    });
  }

  const channelName = `robux-${sanitizeChannelName(robloxUsername)}`;

  const createOpts = {
    name: channelName,
    type: ChannelType.GuildText as const,
    permissionOverwrites: overwrites,
    topic: `Order ${order.orderCode} | Customer: <@${order.discordId}>`,
  };

  // Coba pakai kategori yang dikonfigurasi. Jika kategorinya tidak valid
  // (mis. admin memilih channel biasa, bukan kategori), buat channel tanpa kategori
  // supaya order tetap jalan.
  let channel;
  try {
    channel = await guild.channels.create({ ...createOpts, parent: setting.orderCategoryId || undefined });
  } catch (err) {
    console.error('[createRobuxTicket] Gagal membuat channel dengan kategori, mencoba tanpa kategori:', err);
    channel = await guild.channels.create(createOpts);
  }

  const embed = baseEmbed()
    .setTitle('👑 SULTAN TOP UP')
    .setDescription('Pesanan berhasil dibuat. Ikuti langkah pembayaran di bawah.')
    .addFields(
      { name: 'Order ID', value: order.orderCode, inline: true },
      { name: 'Produk', value: 'Robux', inline: true },
      { name: 'Username Roblox', value: robloxUsername, inline: true },
      { name: 'Jumlah', value: `${order.robuxAmount?.toLocaleString('id-ID')} Robux`, inline: true },
      { name: 'Total', value: formatRupiah(order.price), inline: true },
      { name: 'Status', value: '⏳ Menunggu Pembayaran', inline: true }
    );

  const rulesEmbed = baseEmbed()
    .setTitle('📋 Cara Order & Aturan')
    .setDescription(
      [
        '**Langkah:**',
        '1. Bayar sesuai **Total** persis seperti tertera (jangan dibulatkan).',
        '2. Kirim **bukti transfer (screenshot)** langsung di channel ini.',
        '3. Tunggu staff memverifikasi pembayaran.',
        '4. Robux dikirim manual oleh admin ke username Roblox Anda.',
        '',
        '**Data order Anda:**',
        `• Username Roblox: **${robloxUsername}**`,
        '• Display Name: _(tulis di sini bila berbeda dari username)_',
        '• Bukti Top Up: _(lampirkan screenshot setelah bayar)_',
        '',
        '⚠️ Jangan tutup / hapus ticket sebelum order selesai. Transaksi di luar ticket = risiko ditanggung sendiri.',
      ].join('\n')
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId(CustomId.TICKET_PAY, order.id))
      .setLabel('Pembayaran')
      .setEmoji('💳')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildCustomId(CustomId.TICKET_CALL_STAFF, order.id))
      .setLabel('Panggil Staff')
      .setEmoji('👨‍💻')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildCustomId(CustomId.TICKET_CANCEL, order.id))
      .setLabel('Batalkan')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(buildCustomId(CustomId.TICKET_CLOSE, order.id))
      .setLabel('Tutup Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Secondary)
  );

  await channel.send({ content: `<@${order.discordId}>`, embeds: [embed, rulesEmbed], components: [row] });

  // Info pembayaran + total langsung dikirim, jadi customer tidak perlu menekan tombol / `/pay` dulu.
  // Kalau gagal (mis. link gambar QRIS bermasalah), ticket & order TETAP jadi -
  // customer cukup ketik `/pay` atau tekan tombol Pembayaran.
  try {
    const { embed: paymentEmbed } = await buildPaymentEmbed(order);
    await channel.send({ embeds: [paymentEmbed] });
  } catch (err) {
    console.error('[createRobuxTicket] Gagal mengirim info pembayaran otomatis:', err);
    await channel
      .send({
        embeds: [
          baseEmbed()
            .setTitle('💳 PEMBAYARAN')
            .setDescription(
              `Total: **${formatRupiah(order.price)}**\n\nKetik \`/pay\` atau tekan tombol **Pembayaran** di atas untuk menampilkan metode pembayaran.`
            ),
        ],
      })
      .catch(() => {});
  }

  return channel;
}
