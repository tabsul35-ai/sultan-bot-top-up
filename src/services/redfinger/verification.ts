import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, InteractionEditReplyOptions } from 'discord.js';
import { BRAND } from '../../config/config';
import { baseEmbed } from '../../utils/embeds';
import { CustomId, buildCustomId } from '../../types/customIds';
import type { Verifier } from './redfingerWeb';

/**
 * Jembatan verifikasi perangkat baru Redfinger <-> admin di Discord.
 *
 * Saat bot login dari "perangkat baru", Redfinger menampilkan Security Check. Bot lalu:
 *  1. menampilkan tombol "Kirim Kode Verifikasi" (admin yang memutuskan kode dikirim ke email),
 *  2. menampilkan tombol "Masukkan Kode" → admin mengetik kode dari emailnya sendiri,
 *  3. meneruskan kode itu ke Redfinger.
 * Bot tidak pernah membuat, menebak, atau mengambil kode sendiri.
 *
 * Status tunggu disimpan di memori (per id tugas); kalau bot restart, tugas dianggap batal.
 */

const WAIT_MS = 10 * 60 * 1000;

interface Pending {
  send?: (ok: boolean) => void;
  code?: (code: string | null) => void;
  timer?: NodeJS.Timeout;
}

const pending = new Map<string, Pending>();

type Notify = (payload: InteractionEditReplyOptions) => Promise<unknown>;

function clear(taskId: string) {
  const p = pending.get(taskId);
  if (p?.timer) clearTimeout(p.timer);
  pending.delete(taskId);
}

function promptEmbed(title: string, description: string): EmbedBuilder {
  return baseEmbed().setColor(BRAND.pendingColor).setTitle(title).setDescription(description);
}

/** Buat Verifier yang berkomunikasi lewat pesan (ephemeral) milik admin yang memulai tugas. */
export function createDiscordVerifier(taskId: string, notify: Notify): Verifier {
  return {
    confirmSend: ({ emailMasked }) =>
      new Promise<boolean>((resolve) => {
        clear(taskId);
        const timer = setTimeout(() => {
          clear(taskId);
          resolve(false);
        }, WAIT_MS);
        pending.set(taskId, { send: resolve, timer });
        void notify({
          embeds: [
            promptEmbed(
              '🛂 Redfinger: verifikasi perangkat baru',
              [
                `Redfinger mendeteksi login dari perangkat baru (server bot) untuk **${emailMasked}** dan meminta verifikasi.`,
                '',
                'Tekan **Kirim Kode Verifikasi** → Redfinger mengirim kode ke email akun tersebut. Setelah itu bot meminta Anda memasukkan kodenya.',
                '',
                'Cukup sekali: setelah berhasil, perangkat bot diingat sehingga login berikutnya tidak perlu verifikasi lagi.',
                `Menunggu maksimal ${WAIT_MS / 60000} menit.`,
              ].join('\n')
            ),
          ],
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_VSEND, taskId)).setLabel('Kirim Kode Verifikasi').setEmoji('📧').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_VCANCEL, taskId)).setLabel('Batal').setStyle(ButtonStyle.Secondary)
            ),
          ],
        }).catch(() => {});
      }),

    askCode: ({ attempt, error }) =>
      new Promise<string | null>((resolve) => {
        clear(taskId);
        const timer = setTimeout(() => {
          clear(taskId);
          resolve(null);
        }, WAIT_MS);
        pending.set(taskId, { code: resolve, timer });
        void notify({
          embeds: [
            promptEmbed(
              `🔑 Masukkan kode verifikasi${attempt > 1 ? ` (percobaan ${attempt})` : ''}`,
              [
                error ? `❌ Percobaan sebelumnya ditolak: ${error}\n` : '',
                'Buka email akun Redfinger, salin kode verifikasinya, lalu tekan **Masukkan Kode**.',
                `Menunggu maksimal ${WAIT_MS / 60000} menit.`,
              ].join('\n')
            ),
          ],
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_VCODE, taskId)).setLabel('Masukkan Kode').setEmoji('🔑').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_VCANCEL, taskId)).setLabel('Batal').setStyle(ButtonStyle.Secondary)
            ),
          ],
        }).catch(() => {});
      }),
  };
}

export function isWaiting(taskId: string, what: 'send' | 'code'): boolean {
  return Boolean(pending.get(taskId)?.[what]);
}

/** Admin menekan "Kirim Kode Verifikasi". */
export function approveSend(taskId: string): boolean {
  const p = pending.get(taskId);
  if (!p?.send) return false;
  const resolve = p.send;
  clear(taskId);
  resolve(true);
  return true;
}

/** Admin memasukkan kode. */
export function submitCode(taskId: string, code: string): boolean {
  const p = pending.get(taskId);
  if (!p?.code) return false;
  const resolve = p.code;
  clear(taskId);
  resolve(code);
  return true;
}

/** Admin menekan "Batal". */
export function cancelVerification(taskId: string): boolean {
  const p = pending.get(taskId);
  if (!p) return false;
  clear(taskId);
  p.send?.(false);
  p.code?.(null);
  return true;
}
