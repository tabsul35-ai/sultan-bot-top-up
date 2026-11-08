import { EmbedBuilder } from 'discord.js';
import { Prisma, RedfingerAccount, RedfingerStatus } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { redfingerConfig } from '../../config/config';
import { baseEmbed } from '../../utils/embeds';
import { calendarDaysLeft, formatDue } from './dates';

export const STATUS_META: Record<RedfingerStatus, { label: string; emoji: string }> = {
  ACTIVE: { label: 'active', emoji: '🟢' },
  EXPIRING: { label: 'expiring', emoji: '🟡' },
  RENEWING: { label: 'renewing', emoji: '🔄' },
  EXPIRED: { label: 'expired', emoji: '🔴' },
  REPLACING: { label: 'replacing', emoji: '🔁' },
  REPLACED: { label: 'replaced', emoji: '⚫' },
  FAILED: { label: 'failed', emoji: '❗' },
  DISABLED: { label: 'disabled', emoji: '⚪' },
};

export function statusText(status: RedfingerStatus): string {
  const meta = STATUS_META[status];
  return `${meta.emoji} \`${meta.label}\``;
}

/** Status yang dipantau scheduler (dikirimi pengingat). DISABLED & REPLACED diabaikan. */
export const MONITORED_STATUSES: RedfingerStatus[] = ['ACTIVE', 'EXPIRING', 'RENEWING', 'EXPIRED', 'REPLACING', 'FAILED'];

/** Status yang boleh memulai renew/replace atau ditandai selesai. */
export const ACTIONABLE_STATUSES: RedfingerStatus[] = ['ACTIVE', 'EXPIRING', 'EXPIRED', 'FAILED', 'RENEWING'];

/**
 * Status yang semestinya berdasarkan waktu saja (dipakai setelah renew selesai, enable,
 * batal proses, atau edit tanggal): expired / expiring / active.
 */
export function timeBasedStatus(dueDate: Date, now: Date = new Date()): RedfingerStatus {
  if (dueDate.getTime() <= now.getTime()) return 'EXPIRED';
  const windowDays = Math.max(...redfingerConfig.reminderDays);
  if (calendarDaysLeft(dueDate, now) <= windowDays) return 'EXPIRING';
  return 'ACTIVE';
}

function randomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa 0/O/1/I biar tidak tertukar
  let out = '';
  for (let i = 0; i < 5; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `RF-${out}`;
}

/** Buat akun baru dengan kode RF-XXXXX unik per guild (retry kalau kebetulan bentrok). */
export async function createAccount(data: Omit<Prisma.RedfingerAccountUncheckedCreateInput, 'code'>): Promise<RedfingerAccount> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.redfingerAccount.create({ data: { ...data, code: randomCode() } });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002' && attempt < 4) continue;
      throw err;
    }
  }
  throw new Error('Gagal membuat kode akun unik.');
}

/** Cari akun milik guild berdasarkan kode (RF-XXXXX, tidak case-sensitive) atau id internal. */
export async function findAccount(guildId: string, idOrCode: string): Promise<RedfingerAccount | null> {
  const key = idOrCode.trim();
  if (!key) return null;
  return prisma.redfingerAccount.findFirst({
    where: {
      guildId,
      OR: [{ code: { equals: key, mode: 'insensitive' } }, { id: key }],
    },
  });
}

/** "johndoe@gmail.com" -> "jo•••@gmail.com" - untuk channel yang bisa dilihat banyak admin. */
export function maskIdentifier(value: string | null | undefined): string {
  if (!value) return '-';
  const [user, domain] = value.split('@');
  const visible = user.slice(0, Math.min(2, Math.max(1, user.length - 2)));
  return `${visible}•••${domain ? `@${domain}` : ''}`;
}

export function daysLeftText(dueDate: Date, now: Date = new Date()): string {
  if (dueDate.getTime() <= now.getTime()) return 'sudah habis';
  const days = calendarDaysLeft(dueDate, now);
  if (days <= 0) return 'habis hari ini';
  return `H-${days}`;
}

/**
 * Embed detail akun yang AMAN: password tidak pernah ditampilkan (hanya "tersimpan / tidak").
 * `full=false` menyamarkan username - dipakai untuk pesan di channel (bukan ephemeral).
 */
export function buildAccountEmbed(account: RedfingerAccount, opts: { full?: boolean; title?: string } = {}): EmbedBuilder {
  const full = opts.full ?? false;
  const embed = baseEmbed()
    .setTitle(opts.title ?? `📱 ${account.label}`)
    .addFields(
      { name: 'ID', value: `\`${account.code}\``, inline: true },
      { name: 'Status', value: statusText(account.status), inline: true },
      { name: 'Sisa', value: daysLeftText(account.dueDate), inline: true },
      { name: 'Email/Username', value: full ? account.username || '-' : maskIdentifier(account.username), inline: true },
      { name: 'Password', value: account.passwordEncrypted ? '🔒 tersimpan (terenkripsi)' : '-', inline: true },
      { name: 'Instance/Device ID', value: account.instanceId || '-', inline: true },
      { name: 'Tanggal mulai', value: account.startDate ? formatDue(account.startDate) : '-', inline: true },
      { name: 'Jatuh tempo', value: formatDue(account.dueDate), inline: true },
      { name: 'Update terakhir', value: formatDue(account.updatedAt), inline: true }
    );

  if (full && account.notes) embed.addFields({ name: 'Catatan', value: account.notes.slice(0, 1024) });
  return embed;
}

/** Baris ringkas untuk /redfinger list. */
export function accountListLine(account: RedfingerAccount): string {
  const meta = STATUS_META[account.status];
  const instance = account.instanceId ? ` · ${account.instanceId}` : '';
  return `${meta.emoji} \`${account.code}\` **${account.label}**${instance} — \`${meta.label}\` · ${daysLeftText(account.dueDate)} (<t:${Math.floor(account.dueDate.getTime() / 1000)}:d>)`;
}
