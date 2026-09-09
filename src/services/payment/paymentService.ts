import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { Order } from '@prisma/client';
import { getPaymentSetting } from '../../database/prisma';
import { baseEmbed } from '../../utils/embeds';
import { formatRupiah } from '../robux/robuxPricing';

/**
 * Bangun embed pembayaran manual berdasarkan PaymentSetting yang dikonfigurasi admin (/admin setpayment),
 * digabung dengan total tagihan order yang bersangkutan.
 *
 * Metode yang belum diisi admin tidak akan ditampilkan.
 */
export async function buildPaymentEmbed(order: Order): Promise<{ embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] }> {
  const setting = await getPaymentSetting();

  const embed = baseEmbed()
    .setTitle('💳 PEMBAYARAN')
    .setDescription(
      `⏳ Menunggu pembayaran\n**Total: ${formatRupiah(order.price)}**\n\nSilakan lakukan pembayaran sesuai nominal di atas melalui salah satu metode berikut, lalu upload bukti pembayaran (screenshot) di channel ini.`
    );

  const methods: string[] = [];

  if (setting.qris) methods.push(`**QRIS**\n${setting.qris}${setting.qrisImageUrl ? '\n_(scan gambar QR di bawah)_' : ''}`);
  if (setting.dana) methods.push(`**DANA**\nNomor: ${setting.dana}`);
  if (setting.ovo) methods.push(`**OVO**\nNomor: ${setting.ovo}`);
  if (setting.gopay) methods.push(`**GoPay**\nNomor: ${setting.gopay}`);
  if (setting.bankName || setting.bankAccount) {
    methods.push(
      `**Bank Transfer**\nBank: ${setting.bankName ?? '-'}\nNo. Rekening: ${setting.bankAccount ?? '-'}\nAtas Nama: ${
        setting.bankAccountName ?? '-'
      }`
    );
  }

  if (methods.length === 0) {
    embed.addFields({
      name: '⚠️ Belum Dikonfigurasi',
      value: 'Metode pembayaran belum diatur admin. Silakan hubungi staff.',
    });
  } else {
    embed.addFields(methods.map((value, i) => ({ name: i === 0 ? 'Metode Pembayaran' : '\u200b', value })));
  }

  if (setting.note) {
    embed.addFields({ name: 'Catatan', value: setting.note });
  }

  if (setting.qrisImageUrl && /^https?:\/\//i.test(setting.qrisImageUrl)) {
    try {
      embed.setImage(setting.qrisImageUrl);
    } catch {
      // URL gambar tidak valid - lewati, jangan sampai bikin embed gagal
    }
  }

  // Tidak ada tombol "cek pembayaran" otomatis karena manual - customer cukup upload bukti,
  // staff yang akan menekan tombol verifikasi (muncul otomatis saat staff merespons di ticket).
  return { embed, components: [] };
}
