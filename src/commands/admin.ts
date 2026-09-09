import { ChatInputCommandInteraction, GuildMember, SlashCommandBuilder, TextChannel } from 'discord.js';
import { prisma, getBotSetting, getPaymentSetting } from '../database/prisma';
import { isAdmin } from '../utils/permissions';
import { errorEmbed, successEmbed, baseEmbed } from '../utils/embeds';
import { formatRupiah } from '../services/robux/robuxPricing';

/**
 * Upload lewat slash command = "ephemeral attachment" yang link-nya tidak bisa dipakai ulang
 * di pesan/embed lain. Kirim ulang gambar sebagai pesan biasa (di log channel, atau channel ini)
 * lalu kembalikan URL attachment yang stabil. Pesan itu tidak boleh dihapus.
 */
async function rehostImage(interaction: ChatInputCommandInteraction, sourceUrl: string): Promise<string | null> {
  try {
    const setting = await getBotSetting();
    let target: TextChannel | null = null;

    if (setting.logChannelId) {
      const ch = await interaction.client.channels.fetch(setting.logChannelId).catch(() => null);
      if (ch instanceof TextChannel) target = ch;
    }
    if (!target && interaction.channel instanceof TextChannel) target = interaction.channel;
    if (!target) return null;

    const msg = await target.send({
      content: '🖼️ Gambar QRIS pembayaran — **jangan hapus pesan ini** (dipakai di embed pembayaran).',
      files: [{ attachment: sourceUrl, name: 'qris.png' }],
    });
    return msg.attachments.first()?.url ?? null;
  } catch (err) {
    console.error('[admin setpayment] Gagal re-host gambar QRIS:', err);
    return null;
  }
}

export const data = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Pengaturan admin Sultan Top Up')
  .addSubcommand((sub) =>
    sub
      .setName('setprice')
      .setDescription('Ubah harga Robux per unit (rupiah)')
      .addIntegerOption((opt) => opt.setName('harga').setDescription('Harga per 1 Robux, contoh: 160').setRequired(true).setMinValue(1))
  )
  .addSubcommand((sub) =>
    sub
      .setName('setpayment')
      .setDescription('Atur metode pembayaran manual')
      .addStringOption((opt) => opt.setName('metode').setDescription('qris, dana, ovo, gopay, atau bank').setRequired(true).addChoices(
        { name: 'QRIS', value: 'qris' },
        { name: 'DANA', value: 'dana' },
        { name: 'OVO', value: 'ovo' },
        { name: 'GoPay', value: 'gopay' },
        { name: 'Bank Transfer', value: 'bank' }
      ))
      .addStringOption((opt) => opt.setName('nomor').setDescription('Nomor tujuan / detail rekening (untuk QRIS boleh diisi catatan singkat)').setRequired(true))
      .addStringOption((opt) => opt.setName('nama_bank').setDescription('Khusus metode bank: nama bank').setRequired(false))
      .addStringOption((opt) => opt.setName('atas_nama').setDescription('Khusus metode bank: nama pemilik rekening').setRequired(false))
      .addAttachmentOption((opt) =>
        opt.setName('gambar_qris').setDescription('Khusus QRIS: upload gambar QR (bisa kedaluwarsa, lebih awet pakai link_qris)').setRequired(false)
      )
      .addStringOption((opt) =>
        opt.setName('link_qris').setDescription('Khusus QRIS: link gambar QR permanen (imgur/postimages/dll)').setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('setroles')
      .setDescription('Atur role staff, admin, dan verifikasi member')
      .addRoleOption((opt) => opt.setName('staff').setDescription('Role staff').setRequired(false))
      .addRoleOption((opt) => opt.setName('admin').setDescription('Role admin').setRequired(false))
      .addRoleOption((opt) => opt.setName('verified').setDescription('Role yang diberikan lewat tombol verifikasi member').setRequired(false))
  )
  .addSubcommand((sub) =>
    sub
      .setName('setchannel')
      .setDescription('Atur channel log dan kategori ticket')
      .addChannelOption((opt) => opt.setName('log').setDescription('Channel untuk transaction log').setRequired(false))
      .addChannelOption((opt) => opt.setName('kategori').setDescription('Kategori tempat ticket dibuat').setRequired(false))
  )
  .addSubcommand((sub) => sub.setName('settings').setDescription('Lihat pengaturan saat ini'))
  .addSubcommand((sub) => sub.setName('stats').setDescription('Lihat statistik transaksi'));

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!(interaction.member instanceof GuildMember) || !(await isAdmin(interaction.member))) {
    await interaction.reply({ embeds: [errorEmbed('Command ini hanya untuk admin.')], ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'setprice') {
    const harga = interaction.options.getInteger('harga', true);
    await prisma.botSetting.upsert({
      where: { id: 1 },
      update: { robuxPricePerUnit: harga },
      create: { id: 1, robuxPricePerUnit: harga },
    });
    await interaction.reply({
      embeds: [
        successEmbed(
          `Harga Robux diubah menjadi ${formatRupiah(harga)} / Robux (${formatRupiah(harga * 1000)} / 1.000 Robux).\n\n` +
            'Harga baru langsung dipakai untuk order berikutnya. Jalankan `/panel` lagi di channel panel agar daftar harga di dropdown ikut diperbarui.'
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (sub === 'setpayment') {
    const metode = interaction.options.getString('metode', true);
    const nomor = interaction.options.getString('nomor', true);
    const namaBank = interaction.options.getString('nama_bank') ?? undefined;
    const atasNama = interaction.options.getString('atas_nama') ?? undefined;

    const linkQris = interaction.options.getString('link_qris') ?? undefined;
    const gambarQris = interaction.options.getAttachment('gambar_qris');

    await interaction.deferReply({ ephemeral: true });

    const data: Record<string, string | undefined> = {};
    let qrisNote = '';

    if (metode === 'qris') {
      data.qris = nomor;

      if (linkQris) {
        if (!/^https?:\/\/\S+$/i.test(linkQris) || /ephemeral-attachments/i.test(linkQris)) {
          await interaction.editReply({
            embeds: [
              errorEmbed(
                '`link_qris` harus URL gambar publik (mis. dari postimages.org). Link "ephemeral" Discord tidak bisa dipakai.'
              ),
            ],
          });
          return;
        }
        data.qrisImageUrl = linkQris;
      } else if (gambarQris) {
        if (!gambarQris.contentType?.startsWith('image/')) {
          await interaction.editReply({ embeds: [errorEmbed('File `gambar_qris` harus berupa gambar (PNG/JPG).')] });
          return;
        }
        const hostedUrl = await rehostImage(interaction, gambarQris.url);
        if (!hostedUrl) {
          await interaction.editReply({
            embeds: [
              errorEmbed(
                'Gagal menyimpan gambar QRIS. Atur **Log Channel** dulu lewat `/admin setchannel log:#channel`, atau pakai `link_qris` dengan URL dari situs hosting gambar.'
              ),
            ],
          });
          return;
        }
        data.qrisImageUrl = hostedUrl;
        qrisNote =
          '\n\nGambar QRIS disimpan sebagai pesan di log channel. **Jangan hapus pesan gambar itu**, atau QR akan hilang dari embed pembayaran.';
      }
    }
    if (metode === 'dana') data.dana = nomor;
    if (metode === 'ovo') data.ovo = nomor;
    if (metode === 'gopay') data.gopay = nomor;
    if (metode === 'bank') {
      data.bankAccount = nomor;
      data.bankName = namaBank;
      data.bankAccountName = atasNama;
    }

    await prisma.paymentSetting.upsert({
      where: { id: 1 },
      update: data,
      create: { id: 1, ...data },
    });

    await interaction.editReply({
      embeds: [successEmbed(`Metode pembayaran **${metode.toUpperCase()}** berhasil diperbarui.${qrisNote}`)],
    });
    return;
  }

  if (sub === 'setroles') {
    const staffRole = interaction.options.getRole('staff');
    const adminRole = interaction.options.getRole('admin');
    const verifiedRole = interaction.options.getRole('verified');

    await prisma.botSetting.upsert({
      where: { id: 1 },
      update: {
        ...(staffRole ? { staffRoleId: staffRole.id } : {}),
        ...(adminRole ? { adminRoleId: adminRole.id } : {}),
        ...(verifiedRole ? { verifiedRoleId: verifiedRole.id } : {}),
      },
      create: { id: 1, staffRoleId: staffRole?.id, adminRoleId: adminRole?.id, verifiedRoleId: verifiedRole?.id },
    });

    await interaction.reply({ embeds: [successEmbed('Role staff/admin/verifikasi berhasil diperbarui.')], ephemeral: true });
    return;
  }

  if (sub === 'setchannel') {
    const log = interaction.options.getChannel('log');
    const kategori = interaction.options.getChannel('kategori');

    await prisma.botSetting.upsert({
      where: { id: 1 },
      update: {
        ...(log ? { logChannelId: log.id } : {}),
        ...(kategori ? { orderCategoryId: kategori.id } : {}),
      },
      create: { id: 1, logChannelId: log?.id, orderCategoryId: kategori?.id },
    });

    await interaction.reply({ embeds: [successEmbed('Channel log/kategori berhasil diperbarui.')], ephemeral: true });
    return;
  }

  if (sub === 'settings') {
    const botSetting = await getBotSetting();
    const paymentSetting = await getPaymentSetting();

    const embed = baseEmbed()
      .setTitle('⚙️ Pengaturan Saat Ini')
      .addFields(
        { name: 'Harga Robux', value: `${formatRupiah(botSetting.robuxPricePerUnit)} / Robux`, inline: true },
        { name: 'Staff Role', value: botSetting.staffRoleId ? `<@&${botSetting.staffRoleId}>` : '-', inline: true },
        { name: 'Admin Role', value: botSetting.adminRoleId ? `<@&${botSetting.adminRoleId}>` : '-', inline: true },
        { name: 'Role Verifikasi', value: botSetting.verifiedRoleId ? `<@&${botSetting.verifiedRoleId}>` : '-', inline: true },
        { name: 'Log Channel', value: botSetting.logChannelId ? `<#${botSetting.logChannelId}>` : '-', inline: true },
        { name: 'Kategori Ticket', value: botSetting.orderCategoryId ? `<#${botSetting.orderCategoryId}>` : '-', inline: true },
        { name: 'QRIS', value: paymentSetting.qris ?? '-', inline: true },
        { name: 'DANA', value: paymentSetting.dana ?? '-', inline: true },
        { name: 'OVO', value: paymentSetting.ovo ?? '-', inline: true },
        { name: 'GoPay', value: paymentSetting.gopay ?? '-', inline: true },
        {
          name: 'Bank',
          value: paymentSetting.bankAccount ? `${paymentSetting.bankName} - ${paymentSetting.bankAccount} a.n ${paymentSetting.bankAccountName}` : '-',
        }
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === 'stats') {
    const [totalOrders, completedOrders, revenueAgg, robuxAgg] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { status: 'COMPLETED' } }),
      prisma.order.aggregate({ where: { status: 'COMPLETED' }, _sum: { price: true } }),
      prisma.order.aggregate({ where: { status: 'COMPLETED' }, _sum: { robuxAmount: true } }),
    ]);

    const embed = baseEmbed()
      .setTitle('📊 Dashboard')
      .addFields(
        { name: 'Total Transaksi', value: String(totalOrders), inline: true },
        { name: 'Transaksi Selesai', value: String(completedOrders), inline: true },
        { name: 'Total Pendapatan', value: formatRupiah(revenueAgg._sum.price ?? 0), inline: true },
        { name: 'Total Robux Terjual', value: `${(robuxAgg._sum.robuxAmount ?? 0).toLocaleString('id-ID')} Robux`, inline: true }
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
}
