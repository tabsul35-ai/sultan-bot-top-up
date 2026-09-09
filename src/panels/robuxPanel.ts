import { ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import {
  ROBUX_CUSTOM_MAX,
  ROBUX_CUSTOM_MIN,
  calculateRobuxPrice,
  formatRupiah,
  getRobuxOptions,
} from '../services/robux/robuxPricing';
import { baseEmbed } from '../utils/embeds';
import { CustomId } from '../types/customIds';

// Nilai opsi khusus di dropdown panel: user memilih ini untuk mengetik jumlah Robux sendiri.
export const PANEL_ROBUX_CUSTOM_VALUE = 'custom';

// Judul embed panel - dipakai juga oleh /panel untuk mengenali & menghapus panel lama.
export const PANEL_ROBUX_TITLE = '💎 Pembelian Robux';

/**
 * Panel pembelian Robux permanen untuk dipasang di sebuah channel lewat /panel.
 *
 * Harga di deskripsi tiap opsi "dibekukan" saat panel diposting. Jika harga diubah
 * lewat `/admin setprice`, jalankan `/panel` lagi untuk memposting panel yang baru.
 */
export function buildRobuxPanel(pricePerUnit: number) {
  const options = getRobuxOptions().map((amount) => ({
    label: `${amount.toLocaleString('id-ID')} Robux`,
    description: `Total ${formatRupiah(calculateRobuxPrice(amount, pricePerUnit))}`,
    value: String(amount),
  }));

  options.push({
    label: '✏️ Jumlah lain (custom)',
    description: `Ketik sendiri, ${ROBUX_CUSTOM_MIN.toLocaleString('id-ID')}–${ROBUX_CUSTOM_MAX.toLocaleString('id-ID')} Robux`,
    value: PANEL_ROBUX_CUSTOM_VALUE,
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(CustomId.PANEL_ROBUX_SELECT)
    .setPlaceholder('Pilih nominal Robux...')
    .addOptions(options);

  const embed = baseEmbed()
    .setTitle(PANEL_ROBUX_TITLE)
    .setDescription(
      [
        'Pilih nominal Robux di menu bawah. Total harga tampil di tiap pilihan.',
        `Butuh jumlah lain? Pilih **✏️ Jumlah lain (custom)** (${ROBUX_CUSTOM_MIN.toLocaleString('id-ID')}–${ROBUX_CUSTOM_MAX.toLocaleString('id-ID')} Robux).`,
        '',
        `Harga saat ini: **${formatRupiah(pricePerUnit)} / Robux**`,
        'Setelah memilih, Anda mengisi username Roblox, lalu ticket order otomatis dibuat lengkap dengan info pembayaran.',
      ].join('\n')
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  };
}
