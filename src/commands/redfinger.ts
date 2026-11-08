import { AutocompleteInteraction, ChannelType, ChatInputCommandInteraction, GuildMember, SlashCommandBuilder, TextChannel } from 'discord.js';
import { Prisma, RedfingerStatus } from '@prisma/client';
import { prisma } from '../database/prisma';
import { isAdmin, isRedfingerAdmin } from '../utils/permissions';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { BRAND, redfingerConfig } from '../config/config';
import { STATUS_META, buildAccountEmbed, daysLeftText, findAccount, statusText, timeBasedStatus } from '../services/redfinger/accountService';
import { dateInputHint, parseDateInput } from '../services/redfinger/dates';
import { logRedfingerAction } from '../services/redfinger/notify';
import { setAccountDisabled, startRenew, startReplace } from '../services/redfinger/workflow';
import { buildDetailEmbed, buildListEmbed, buildSetupEmbed, deleteConfirmMessage } from '../services/redfinger/views';
import { PANEL_REDFINGER_TITLE, buildRedfingerPanel } from '../panels/redfingerPanel';
import { tidyPanelChannel } from '../utils/channelPanel';
import { buildRedfingerAddModal, buildRedfingerPasswordModal } from '../modals/redfingerModals';
import { renewStartedReply, replaceStartedReply } from '../buttons/redfinger';

const STATUS_CHOICES = (Object.keys(STATUS_META) as RedfingerStatus[]).map((s) => ({ name: STATUS_META[s].label, value: s }));

function idOption(sub: any) {
  return sub.addStringOption((opt: any) =>
    opt.setName('id').setDescription('ID akun (RF-XXXXX) - ketik untuk mencari').setRequired(true).setAutocomplete(true)
  );
}

export const data = new SlashCommandBuilder()
  .setName('redfinger')
  .setDescription('Manajemen akun/instance Redfinger (khusus admin)')
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Daftarkan akun/instance Redfinger baru (form popup)')
      .addStringOption((opt) => opt.setName('mulai').setDescription('Tanggal mulai (default: hari ini), mis. 2026-11-01').setRequired(false))
  )
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('Lihat akun, status, dan masa aktif')
      .addStringOption((opt) => opt.setName('status').setDescription('Filter status').setRequired(false).addChoices(...STATUS_CHOICES))
  )
  .addSubcommand((sub) => idOption(sub.setName('detail').setDescription('Detail akun (tanpa password)')))
  .addSubcommand((sub) =>
    idOption(sub.setName('edit').setDescription('Ubah data akun (isi "-" untuk mengosongkan field teks)'))
      .addStringOption((opt: any) => opt.setName('label').setDescription('Nama/label baru').setRequired(false).setMaxLength(60))
      .addStringOption((opt: any) => opt.setName('username').setDescription('Email/username login').setRequired(false).setMaxLength(200))
      .addStringOption((opt: any) => opt.setName('instance_id').setDescription('Instance/Device ID').setRequired(false).setMaxLength(100))
      .addStringOption((opt: any) => opt.setName('mulai').setDescription('Tanggal mulai, mis. 2026-11-01').setRequired(false))
      .addStringOption((opt: any) => opt.setName('jatuh_tempo').setDescription('Jatuh tempo, mis. 2026-12-31 atau 2026-12-31 14:00').setRequired(false))
      .addStringOption((opt: any) => opt.setName('catatan').setDescription('Catatan').setRequired(false).setMaxLength(1000))
      .addStringOption((opt: any) => opt.setName('status').setDescription('Paksa status (override manual)').setRequired(false).addChoices(...STATUS_CHOICES))
      .addBooleanOption((opt: any) => opt.setName('ganti_password').setDescription('Buka form untuk mengganti/menghapus password').setRequired(false))
  )
  .addSubcommand((sub) =>
    idOption(sub.setName('renew').setDescription('Mulai proses renew')).addStringOption((opt: any) =>
      opt
        .setName('mode')
        .setDescription(`Default: ${redfingerConfig.renewMode}`)
        .setRequired(false)
        .addChoices({ name: 'manual (checklist)', value: 'manual' }, { name: 'browser (Playwright)', value: 'browser' })
    )
  )
  .addSubcommand((sub) => idOption(sub.setName('replace').setDescription('Mulai proses penggantian akun/instance')))
  .addSubcommand((sub) => idOption(sub.setName('disable').setDescription('Nonaktifkan akun (tidak dipantau/diingatkan)')))
  .addSubcommand((sub) => idOption(sub.setName('enable').setDescription('Aktifkan lagi akun yang dinonaktifkan')))
  .addSubcommand((sub) => idOption(sub.setName('delete').setDescription('Hapus akun permanen (dengan konfirmasi)')))
  .addSubcommand((sub) =>
    sub
      .setName('panel')
      .setDescription('Pasang panel tombol Redfinger permanen di channel ini')
      .addBooleanOption((opt) =>
        opt.setName('bersihkan').setDescription('Hapus semua pesan lain di channel ini lebih dulu (maks 100, umur < 14 hari)').setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('setup')
      .setDescription('Atur channel notifikasi/log & role admin Redfinger (tanpa opsi = lihat pengaturan)')
      .addChannelOption((opt) =>
        opt.setName('admin_channel').setDescription('Channel pengingat & notifikasi').addChannelTypes(ChannelType.GuildText).setRequired(false)
      )
      .addChannelOption((opt) =>
        opt.setName('log_channel').setDescription('Channel audit log (opsional)').addChannelTypes(ChannelType.GuildText).setRequired(false)
      )
      .addRoleOption((opt) => opt.setName('role').setDescription('Role yang boleh memakai /redfinger').setRequired(false))
  );

/** Autocomplete opsi `id`: cari berdasarkan kode, label, atau instance ID. */
export async function autocomplete(interaction: AutocompleteInteraction) {
  const guildId = interaction.guildId;
  if (!guildId || !(interaction.member instanceof GuildMember) || !(await isRedfingerAdmin(interaction.member))) {
    await interaction.respond([]);
    return;
  }

  const query = String(interaction.options.getFocused() ?? '').trim();
  const accounts = await prisma.redfingerAccount.findMany({
    where: {
      guildId,
      ...(query
        ? {
            OR: [
              { code: { contains: query, mode: 'insensitive' } },
              { label: { contains: query, mode: 'insensitive' } },
              { instanceId: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { dueDate: 'asc' },
    take: 25,
  });

  await interaction.respond(
    accounts.map((a) => ({
      name: `${a.code} · ${a.label} · ${STATUS_META[a.status].label} · ${daysLeftText(a.dueDate)}`.slice(0, 100),
      value: a.code,
    }))
  );
}

/** Teks opsional: null = tidak diubah, "-" = kosongkan. */
function textChange(value: string | null): string | null | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed === '-' || trimmed === '' ? null : trimmed;
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!(interaction.member instanceof GuildMember) || !(await isRedfingerAdmin(interaction.member))) {
    await interaction.reply({ embeds: [errorEmbed('Command ini hanya untuk admin Redfinger.')], ephemeral: true });
    return;
  }
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ embeds: [errorEmbed('Command ini hanya bisa digunakan di dalam server.')], ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  const actorId = interaction.user.id;
  const client = interaction.client;

  // ===== add: form popup (showModal harus jadi respons pertama) =====
  if (sub === 'add') {
    const mulaiRaw = interaction.options.getString('mulai');
    let startEpoch: number | undefined;
    if (mulaiRaw) {
      const start = parseDateInput(mulaiRaw);
      if (!start) {
        await interaction.reply({ embeds: [errorEmbed(`Tanggal \`mulai\` tidak valid. ${dateInputHint()}`)], ephemeral: true });
        return;
      }
      startEpoch = Math.floor(start.getTime() / 1000);
    }
    await interaction.showModal(buildRedfingerAddModal(startEpoch));
    return;
  }

  // ===== panel: pasang panel tombol permanen di channel ini =====
  if (sub === 'panel') {
    const channel = interaction.channel;
    if (!(channel instanceof TextChannel)) {
      await interaction.reply({ embeds: [errorEmbed('Jalankan command ini di dalam channel teks biasa.')], ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });

    const catatan = await tidyPanelChannel(channel, {
      botId: client.user.id,
      panelTitle: PANEL_REDFINGER_TITLE,
      bersihkan: interaction.options.getBoolean('bersihkan') ?? false,
    });
    await channel.send(buildRedfingerPanel());

    // Panel aman dilihat siapa saja (tombol mengecek izin, balasan ephemeral), tapi lebih rapi di channel khusus admin.
    const everyoneCanSee = channel.permissionsFor(channel.guild.roles.everyone)?.has('ViewChannel') ?? false;
    await interaction.editReply({
      embeds: [
        successEmbed(
          'Panel Redfinger dipasang di channel ini.' +
            catatan +
            (everyoneCanSee
              ? '\n\nℹ️ Channel ini bisa dilihat @everyone. Tombol tetap hanya bisa dipakai admin Redfinger, tapi sebaiknya pasang panel di channel khusus admin.'
              : '')
        ),
      ],
    });
    await logRedfingerAction(client, {
      guildId,
      action: 'PANEL',
      title: '📱 Panel Redfinger dipasang',
      message: `Panel dipasang di <#${channel.id}>.`,
      actorId,
    });
    return;
  }

  // ===== setup =====
  if (sub === 'setup') {
    if (!(await isAdmin(interaction.member))) {
      await interaction.reply({ embeds: [errorEmbed('Pengaturan Redfinger hanya bisa diubah admin server.')], ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const adminChannel = interaction.options.getChannel('admin_channel');
    const logChannel = interaction.options.getChannel('log_channel');
    const role = interaction.options.getRole('role');

    if (adminChannel || logChannel || role) {
      await prisma.redfingerSetting.upsert({
        where: { guildId },
        update: {
          ...(adminChannel ? { adminChannelId: adminChannel.id } : {}),
          ...(logChannel ? { logChannelId: logChannel.id } : {}),
          ...(role ? { adminRoleId: role.id } : {}),
        },
        create: { guildId, adminChannelId: adminChannel?.id, logChannelId: logChannel?.id, adminRoleId: role?.id },
      });
      await logRedfingerAction(client, {
        guildId,
        action: 'SETUP',
        title: '⚙️ Pengaturan Redfinger diubah',
        message: [
          adminChannel ? `Channel admin: <#${adminChannel.id}>` : null,
          logChannel ? `Channel log: <#${logChannel.id}>` : null,
          role ? `Role: <@&${role.id}>` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        actorId,
      });
    }

    await interaction.editReply({ embeds: [await buildSetupEmbed(guildId)] });
    return;
  }

  // ===== list =====
  if (sub === 'list') {
    await interaction.deferReply({ ephemeral: true });
    const status = interaction.options.getString('status') as RedfingerStatus | null;
    await interaction.editReply({ embeds: [await buildListEmbed(guildId, status)] });
    return;
  }

  // ===== subcommand yang butuh akun =====
  const idInput = interaction.options.getString('id', true);
  const account = await findAccount(guildId, idInput);
  if (!account) {
    await interaction.reply({ embeds: [errorEmbed(`Akun \`${idInput}\` tidak ditemukan. Cek \`/redfinger list\`.`)], ephemeral: true });
    return;
  }

  if (sub === 'detail') {
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({ embeds: [await buildDetailEmbed(account)], allowedMentions: { parse: [] } });
    return;
  }

  if (sub === 'edit') {
    const changes: Prisma.RedfingerAccountUpdateInput = {};
    const changed: string[] = [];

    const label = interaction.options.getString('label');
    if (label?.trim()) {
      changes.label = label.trim();
      changed.push('label');
    }
    for (const [option, field] of [
      ['username', 'username'],
      ['instance_id', 'instanceId'],
      ['catatan', 'notes'],
    ] as const) {
      const value = textChange(interaction.options.getString(option));
      if (value !== undefined) {
        (changes as Record<string, unknown>)[field] = value;
        changed.push(option);
      }
    }

    const mulaiRaw = interaction.options.getString('mulai');
    if (mulaiRaw) {
      const start = parseDateInput(mulaiRaw);
      if (!start) {
        await interaction.reply({ embeds: [errorEmbed(`Tanggal \`mulai\` tidak valid. ${dateInputHint()}`)], ephemeral: true });
        return;
      }
      changes.startDate = start;
      changed.push('mulai');
    }

    const dueRaw = interaction.options.getString('jatuh_tempo');
    let newDue: Date | null = null;
    if (dueRaw) {
      newDue = parseDateInput(dueRaw, account.dueDate);
      if (!newDue) {
        await interaction.reply({ embeds: [errorEmbed(`Tanggal \`jatuh_tempo\` tidak valid. ${dateInputHint()}`)], ephemeral: true });
        return;
      }
      changes.dueDate = newDue;
      changed.push('jatuh_tempo');
    }

    const forcedStatus = interaction.options.getString('status') as RedfingerStatus | null;
    if (forcedStatus) {
      changes.status = forcedStatus;
      changed.push('status');
    } else if (newDue && ['ACTIVE', 'EXPIRING', 'EXPIRED'].includes(account.status)) {
      // Jatuh tempo berubah -> status berbasis waktu ikut disesuaikan.
      changes.status = timeBasedStatus(newDue);
    }

    const wantsPassword = interaction.options.getBoolean('ganti_password') === true;

    if (changed.length === 0 && !wantsPassword) {
      await interaction.reply({ embeds: [errorEmbed('Tidak ada yang diubah. Isi minimal satu opsi.')], ephemeral: true });
      return;
    }

    const updated = changed.length > 0 ? await prisma.redfingerAccount.update({ where: { id: account.id }, data: changes }) : account;

    // Balas/buka modal DULU (batas 3 detik Discord), baru tulis audit log yang juga kirim ke channel.
    if (wantsPassword) {
      // Perubahan lain (kalau ada) sudah tersimpan di atas; form password jadi respons interaksi ini.
      await interaction.showModal(buildRedfingerPasswordModal(updated));
    } else {
      await interaction.reply({
        embeds: [buildAccountEmbed(updated, { full: true, title: `✏️ Diubah — ${updated.label}` }).setColor(BRAND.successColor)],
        ephemeral: true,
      });
    }

    if (changed.length > 0) {
      await logRedfingerAction(client, {
        guildId,
        accountId: account.id,
        action: 'EDIT',
        title: '✏️ Akun Redfinger diubah',
        message: `**${updated.label}** (\`${updated.code}\`) diubah: ${changed.join(', ')}.${
          changes.status ? ` Status: ${statusText(account.status)} → ${statusText(updated.status)}.` : ''
        }`,
        actorId,
      });
    }
    return;
  }

  if (sub === 'renew') {
    await interaction.deferReply({ ephemeral: true });
    const mode = interaction.options.getString('mode') as 'manual' | 'browser' | null;
    if (account.status === 'RENEWING' && mode !== 'browser') {
      await interaction.editReply(renewStartedReply(account, 'manual', '-', 'Renew akun ini sudah berjalan - checklist ditampilkan lagi.'));
      return;
    }
    const res = await startRenew(client, account, actorId, mode);
    if (!res.ok) {
      await interaction.editReply({ embeds: [errorEmbed(res.error)] });
      return;
    }
    await interaction.editReply(renewStartedReply(res.value.account, res.value.mode, res.value.job.id, res.note));
    return;
  }

  if (sub === 'replace') {
    await interaction.deferReply({ ephemeral: true });
    const res = await startReplace(client, account, actorId);
    if (!res.ok) {
      await interaction.editReply({ embeds: [errorEmbed(res.error)] });
      return;
    }
    await interaction.editReply(replaceStartedReply(res.value, res.note));
    return;
  }

  if (sub === 'disable' || sub === 'enable') {
    await interaction.deferReply({ ephemeral: true });
    const res = await setAccountDisabled(client, account, actorId, sub === 'disable');
    await interaction.editReply({ embeds: [res.ok ? successEmbed(`\`${account.code}\` sekarang ${statusText(res.value.status)}.`) : errorEmbed(res.error)] });
    return;
  }

  if (sub === 'delete') {
    await interaction.reply({ ...deleteConfirmMessage(account, actorId), ephemeral: true });
    return;
  }
}
