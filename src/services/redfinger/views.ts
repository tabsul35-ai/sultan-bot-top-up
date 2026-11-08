import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { RedfingerAccount, RedfingerStatus } from '@prisma/client';
import { getRedfingerSetting, prisma } from '../../database/prisma';
import { BRAND, redfingerConfig } from '../../config/config';
import { baseEmbed, errorEmbed } from '../../utils/embeds';
import { CustomId, buildCustomId } from '../../types/customIds';
import { STATUS_META, accountListLine, buildAccountEmbed, daysLeftText } from './accountService';
import { browserAutomationStatus } from './browserAutomation';
import { isEncryptionConfigured } from './crypto';
import { tzLabel } from './dates';

/**
 * Tampilan (embed + komponen) Redfinger yang dipakai bersama oleh /redfinger dan panel
 * Redfinger di channel, supaya isinya selalu sama dari mana pun dibuka.
 */

/** Daftar akun (default: semua kecuali `replaced`), urut jatuh tempo terdekat. */
export async function buildListEmbed(guildId: string, status: RedfingerStatus | null): Promise<EmbedBuilder> {
  const accounts = await prisma.redfingerAccount.findMany({
    where: { guildId, ...(status ? { status } : { status: { not: 'REPLACED' } }) },
    orderBy: { dueDate: 'asc' },
  });

  if (accounts.length === 0) {
    return errorEmbed(
      status ? `Tidak ada akun berstatus \`${STATUS_META[status].label}\`.` : 'Belum ada akun Redfinger. Tambahkan lewat tombol **Tambah Akun** atau `/redfinger add`.'
    );
  }

  const lines: string[] = [];
  let length = 0;
  for (const account of accounts) {
    const line = accountListLine(account);
    if (length + line.length + 1 > 3800) break;
    lines.push(line);
    length += line.length + 1;
  }
  const hidden = accounts.length - lines.length;

  const counts = accounts.reduce<Record<string, number>>((acc, a) => ((acc[a.status] = (acc[a.status] ?? 0) + 1), acc), {});
  const summary = Object.entries(counts)
    .map(([s, n]) => `${STATUS_META[s as RedfingerStatus].emoji} ${STATUS_META[s as RedfingerStatus].label}: ${n}`)
    .join(' · ');

  return baseEmbed()
    .setTitle(`📱 Akun Redfinger (${accounts.length})${status ? ` — ${STATUS_META[status].label}` : ''}`)
    .setDescription(lines.join('\n') + (hidden > 0 ? `\n\n…dan ${hidden} akun lagi (pakai \`/redfinger list status:\`).` : ''))
    .addFields({ name: 'Ringkasan', value: summary });
}

/** Detail lengkap (tanpa password) + job terakhir + 5 audit terakhir. Hanya untuk balasan ephemeral. */
export async function buildDetailEmbed(account: RedfingerAccount): Promise<EmbedBuilder> {
  const [lastJob, logs, replacedBy, replaces] = await Promise.all([
    prisma.redfingerJob.findFirst({ where: { accountId: account.id }, orderBy: { createdAt: 'desc' } }),
    prisma.redfingerAuditLog.findMany({ where: { accountId: account.id }, orderBy: { createdAt: 'desc' }, take: 5 }),
    account.replacedById ? prisma.redfingerAccount.findUnique({ where: { id: account.replacedById } }) : null,
    account.replacesId ? prisma.redfingerAccount.findUnique({ where: { id: account.replacesId } }) : null,
  ]);

  const embed = buildAccountEmbed(account, { full: true });
  if (replacedBy) embed.addFields({ name: 'Digantikan oleh', value: `\`${replacedBy.code}\` ${replacedBy.label}`, inline: true });
  if (replaces) embed.addFields({ name: 'Pengganti dari', value: `\`${replaces.code}\` ${replaces.label}`, inline: true });
  if (lastJob) {
    embed.addFields({
      name: 'Job terakhir',
      value: `${lastJob.type} · ${lastJob.mode} · **${lastJob.status}** · <t:${Math.floor(lastJob.updatedAt.getTime() / 1000)}:R>${
        lastJob.message ? `\n${lastJob.message.slice(0, 300)}` : ''
      }`,
    });
  }
  if (logs.length) {
    embed.addFields({
      name: 'Audit terakhir',
      value: logs
        .map((l) => `<t:${Math.floor(l.createdAt.getTime() / 1000)}:R> \`${l.action}\`${l.actorId ? ` <@${l.actorId}>` : ''}`)
        .join('\n')
        .slice(0, 1024),
    });
  }
  return embed;
}

export async function buildSetupEmbed(guildId: string): Promise<EmbedBuilder> {
  const setting = await getRedfingerSetting(guildId);
  const browser = browserAutomationStatus();
  return baseEmbed()
    .setTitle('⚙️ Pengaturan Redfinger')
    .addFields(
      { name: 'Channel admin (pengingat)', value: setting.adminChannelId ? `<#${setting.adminChannelId}>` : '⚠️ belum diatur (fallback: log channel toko)', inline: true },
      { name: 'Channel audit log', value: setting.logChannelId ? `<#${setting.logChannelId}>` : '-', inline: true },
      { name: 'Role admin Redfinger', value: setting.adminRoleId ? `<@&${setting.adminRoleId}>` : '- (hanya admin server)', inline: true },
      { name: 'Pengingat (env)', value: `H-${redfingerConfig.reminderDays.join(', H-')} + saat habis`, inline: true },
      { name: 'Interval cek (env)', value: `${redfingerConfig.checkIntervalMinutes} menit`, inline: true },
      { name: 'Zona waktu (env)', value: tzLabel(), inline: true },
      { name: 'Enkripsi password (env)', value: isEncryptionConfigured() ? '🔒 aktif' : '⚠️ REDFINGER_ENCRYPTION_KEY belum diatur', inline: true },
      { name: 'Mode renew default (env)', value: redfingerConfig.renewMode, inline: true },
      { name: 'Otomasi browser', value: browser.available ? '✅ tersedia' : `⚪ ${browser.reason}`, inline: false }
    )
    .setDescription('Ubah channel/role lewat `/redfinger setup admin_channel:… log_channel:… role:…` (admin server).');
}

/** Pesan konfirmasi hapus - tombol konfirmasi terikat ke admin yang meminta. */
export function deleteConfirmMessage(account: RedfingerAccount, actorId: string) {
  const embed = buildAccountEmbed(account, { title: `🗑️ Hapus ${account.label}?` })
    .setColor(BRAND.errorColor)
    .setDescription(
      '**Tindakan ini permanen.** Data akun, riwayat pengingat, dan job akan dihapus (audit log tetap disimpan).\n' +
        'Kalau hanya ingin berhenti memantau, pakai **Nonaktifkan**.'
    );
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId(CustomId.RF_DELETE_CONFIRM, account.id, actorId))
      .setLabel(`Ya, hapus ${account.code} permanen`)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(CustomId.RF_DELETE_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [buttons] };
}

/** Dropdown pilih akun untuk tombol "Kelola Akun" di panel (maks 25 akun, jatuh tempo terdekat dulu). */
export async function buildAccountPicker(guildId: string) {
  const accounts = await prisma.redfingerAccount.findMany({
    where: { guildId, status: { not: 'REPLACED' } },
    orderBy: { dueDate: 'asc' },
  });
  if (accounts.length === 0) return null;

  const shown = accounts.slice(0, 25);
  const select = new StringSelectMenuBuilder()
    .setCustomId(CustomId.RF_PANEL_SELECT)
    .setPlaceholder('Pilih akun yang ingin dikelola...')
    .addOptions(
      shown.map((a) => ({
        label: `${a.code} · ${a.label}`.slice(0, 100),
        description: `${STATUS_META[a.status].label} · ${daysLeftText(a.dueDate)}${a.instanceId ? ` · ${a.instanceId}` : ''}`.slice(0, 100),
        value: a.id,
        emoji: STATUS_META[a.status].emoji,
      }))
    );

  const note =
    accounts.length > shown.length
      ? `Menampilkan ${shown.length} dari ${accounts.length} akun (jatuh tempo terdekat). Akun lain: \`/redfinger detail id:\`.`
      : 'Pilih akun untuk melihat detail dan aksinya.';
  return { content: note, components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] };
}

/** Tombol aksi untuk satu akun (dipakai setelah memilih akun di panel). */
export function manageButtons(account: RedfingerAccount): ActionRowBuilder<ButtonBuilder>[] {
  const id = account.id;
  const inactive = account.status === 'DISABLED' || account.status === 'REPLACED';

  const main = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_RENEW, id)).setLabel('Renew').setEmoji('🔄').setStyle(ButtonStyle.Primary).setDisabled(inactive),
    new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_REPLACE, id)).setLabel('Replace').setEmoji('🔁').setStyle(ButtonStyle.Secondary).setDisabled(inactive),
    new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_DONE, id)).setLabel('Tandai Selesai').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(inactive)
  );

  const other = new ActionRowBuilder<ButtonBuilder>().addComponents(
    account.status === 'DISABLED'
      ? new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_ENABLE, id)).setLabel('Aktifkan').setEmoji('🟢').setStyle(ButtonStyle.Success)
      : new ButtonBuilder()
          .setCustomId(buildCustomId(CustomId.RF_DISABLE, id))
          .setLabel('Nonaktifkan')
          .setEmoji('⚪')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(account.status === 'REPLACED'),
    new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_PASSWORD, id)).setLabel('Ganti Password').setEmoji('🔑').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_DELETE, id)).setLabel('Hapus').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
  );

  return [main, other];
}
