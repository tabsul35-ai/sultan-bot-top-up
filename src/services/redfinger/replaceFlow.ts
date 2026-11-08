import { randomBytes } from 'crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { RedfingerAccount } from '@prisma/client';
import { BRAND } from '../../config/config';
import { baseEmbed } from '../../utils/embeds';
import { CustomId, buildCustomId } from '../../types/customIds';
import { daysLeftText } from './accountService';
import type { ReplaceOptions } from './redfingerWeb';

/**
 * Tampilan & sesi alur Replace otomatis di Discord:
 *   pilih device → bot ambil opsi dari Redfinger → pilih "Region · Android" → Ganti Spesifikasi
 *   → konfirmasi (data device terhapus sesuai aturan Redfinger) → bot menjalankan replace.
 * Sesi disimpan di memori 15 menit (cukup untuk satu alur interaksi ephemeral).
 */

export interface ReplaceSession {
  id: string;
  guildId: string;
  userId: string;
  accountId: string;
  label: string;
  code: string;
  padCode: string;
  options: ReplaceOptions;
  choices: { version: string; server: string; latency: string | null }[];
  chosen: number | null;
  createdAt: number;
}

const TTL_MS = 15 * 60 * 1000;
const sessions = new Map<string, ReplaceSession>();

function prune() {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.createdAt > TTL_MS) sessions.delete(id);
}

export function createReplaceSession(account: RedfingerAccount, userId: string, options: ReplaceOptions): ReplaceSession {
  prune();
  const choices = options.versions.flatMap((v) => v.servers.map((s) => ({ version: v.version, server: s.name, latency: s.latency })));
  const session: ReplaceSession = {
    id: randomBytes(5).toString('hex'),
    guildId: account.guildId,
    userId,
    accountId: account.id,
    label: account.label,
    code: account.code,
    padCode: account.instanceId ?? '-',
    options,
    choices,
    chosen: null,
    createdAt: Date.now(),
  };
  sessions.set(session.id, session);
  return session;
}

export function getReplaceSession(id: string): ReplaceSession | null {
  prune();
  return sessions.get(id) ?? null;
}

export function endReplaceSession(id: string) {
  sessions.delete(id);
}

const FLAGS: [RegExp, string][] = [
  [/hong ?kong|^hk/i, '🇭🇰'],
  [/thai/i, '🇹🇭'],
  [/viet/i, '🇻🇳'],
  [/singap|^sg/i, '🇸🇬'],
  [/taiwan|^tw/i, '🇹🇼'],
  [/united states|^us|america/i, '🇺🇸'],
  [/japan|^jp/i, '🇯🇵'],
  [/korea|^kr/i, '🇰🇷'],
  [/indonesia|^id\b/i, '🇮🇩'],
  [/malay/i, '🇲🇾'],
  [/philipp/i, '🇵🇭'],
];

export function regionFlag(name: string | null | undefined): string {
  if (!name) return '🌐';
  return FLAGS.find(([re]) => re.test(name))?.[1] ?? '🌐';
}

function choiceLabel(c: { version: string; server: string }) {
  return `${c.server} · Android ${c.version}`;
}

/** Pesan pemilihan region/ROM (dan tombol Ganti Spesifikasi) untuk satu sesi. */
export function replaceSessionView(session: ReplaceSession, account: RedfingerAccount) {
  const { current, rules } = session.options;
  const chosen = session.chosen !== null ? session.choices[session.chosen] : null;

  const embed = baseEmbed()
    .setColor(BRAND.pendingColor)
    .setTitle(`📘 Replace — ${session.label}`)
    .setDescription(
      [
        `Device: **${session.label}** · Code: \`${session.padCode}\` (${daysLeftText(account.dueDate)})`,
        `Sekarang: ${regionFlag(current.region)} **${current.region ?? account.region ?? '-'} · Android ${current.version ?? account.androidVersion ?? '-'}**`,
        '',
        chosen
          ? `Tujuan: ${regionFlag(chosen.server)} **${choiceLabel(chosen)}**${chosen.latency ? ` (${chosen.latency})` : ''}\nTekan **Ganti Spesifikasi (Replace)** untuk lanjut.`
          : 'Silakan pilih **region & ROM** yang baru di menu bawah.',
      ].join('\n')
    );
  if (rules) embed.addFields({ name: '📜 Aturan Redfinger', value: rules.slice(0, 1000) });

  const rows: ActionRowBuilder<any>[] = [];
  // Maks 25 opsi per menu → pecah jadi beberapa menu bila perlu (maks 3 menu).
  for (let chunk = 0; chunk * 25 < session.choices.length && chunk < 3; chunk++) {
    const slice = session.choices.slice(chunk * 25, chunk * 25 + 25);
    const select = new StringSelectMenuBuilder()
      .setCustomId(buildCustomId(CustomId.RF_RPL_OPT, session.id, chunk))
      .setPlaceholder(session.choices.length > 25 ? `Pilih region tujuan... (${chunk + 1})` : 'Pilih region tujuan...')
      .addOptions(
        slice.map((c, i) => {
          const index = chunk * 25 + i;
          return {
            label: choiceLabel(c).slice(0, 100),
            description: c.latency ? `Ping ${c.latency}` : undefined,
            value: String(index),
            emoji: regionFlag(c.server),
            default: session.chosen === index,
          };
        })
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildCustomId(CustomId.RF_RPL_GO, session.id))
        .setLabel('Ganti Spesifikasi (Replace)')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!chosen),
      new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_RPL_CANCEL, session.id)).setLabel('Batal').setStyle(ButtonStyle.Secondary)
    )
  );
  return { content: null, embeds: [embed], components: rows };
}

/** Konfirmasi terakhir sebelum replace dijalankan. */
export function replaceConfirmView(session: ReplaceSession) {
  const chosen = session.choices[session.chosen!];
  return {
    embeds: [
      baseEmbed()
        .setColor(BRAND.errorColor)
        .setTitle(`⚠️ Konfirmasi Replace — ${session.label}`)
        .setDescription(
          [
            `\`${session.padCode}\` → ${regionFlag(chosen.server)} **${choiceLabel(chosen)}**`,
            '',
            '**Data di device lama akan dihapus** setelah replace (aturan Redfinger). Pastikan data penting sudah dicadangkan.',
            'Masa aktif device tetap.',
          ].join('\n')
        ),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_RPL_YES, session.id)).setLabel('Ya, Replace Sekarang').setEmoji('🔁').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_RPL_CANCEL, session.id)).setLabel('Batal').setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

export function progressEmbed(text: string): EmbedBuilder {
  return baseEmbed().setColor(BRAND.pendingColor).setDescription(text);
}
