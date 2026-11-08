import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  GuildMember,
  MessageComponentInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { RedfingerAccount } from '@prisma/client';
import { CustomId, buildCustomId } from '../types/customIds';
import { prisma } from '../database/prisma';
import { isRedfingerAdmin } from '../utils/permissions';
import { errorEmbed, successEmbed, baseEmbed } from '../utils/embeds';
import { BRAND } from '../config/config';
import { ACTIONABLE_STATUSES, buildAccountEmbed, findAccount, maskIdentifier, statusText } from '../services/redfinger/accountService';
import { fetchReplaceOptions, loginsNeedingRetry, logoutLogin, managerStats, runLoginSync, runReplace } from '../services/redfinger/loginService';
import { buildRedfingerPanel } from '../panels/redfingerPanel';
import { approveSend, cancelVerification, isWaiting } from '../services/redfinger/verification';
import {
  createReplaceSession,
  endReplaceSession,
  getReplaceSession,
  progressEmbed,
  regionFlag,
  replaceConfirmView,
  replaceSessionView,
} from '../services/redfinger/replaceFlow';
import { logRedfingerAction, renewProgressButtons, replaceProgressButtons } from '../services/redfinger/notify';
import { cancelProcess, markProcessFailed, renewChecklistEmbed, setAccountDisabled, startRenew, startReplace } from '../services/redfinger/workflow';
import {
  buildAccountPicker,
  buildDetailEmbed,
  buildListEmbed,
  buildLoginPicker,
  buildLoginsEmbed,
  buildSetupEmbed,
  deleteConfirmMessage,
  manageButtons,
  syncResultEmbed,
} from '../services/redfinger/views';
import {
  buildRedfingerAddModal,
  buildRedfingerDueModal,
  buildRedfingerPasswordModal,
  buildRedfingerRegisterModal,
  buildRedfingerReplaceModal,
  buildRedfingerVerifyCodeModal,
} from '../modals/redfingerModals';

/**
 * Balasan standar setelah renew dimulai (dipakai juga oleh /redfinger renew).
 * Manual -> checklist + tombol; browser -> info job berjalan.
 */
export function renewStartedReply(account: RedfingerAccount, mode: 'manual' | 'browser', jobId: string, note?: string) {
  if (mode === 'manual') {
    return { content: note, embeds: [renewChecklistEmbed(account)], components: [renewProgressButtons(account.id)] };
  }
  return {
    content: note,
    embeds: [
      baseEmbed()
        .setColor(BRAND.pendingColor)
        .setTitle(`🌐 Renew via browser dimulai — ${account.label}`)
        .setDescription(
          `Job \`${jobId}\` berjalan di latar belakang. Hasilnya (berhasil / gagal / perlu verifikasi manual) dikirim ke channel admin Redfinger.\n\nBot **tidak** melakukan pembayaran dan tidak mencoba melewati CAPTCHA/OTP.`
        ),
    ],
    components: [],
  };
}

export function replaceStartedReply(account: RedfingerAccount, note?: string) {
  return {
    content: note,
    embeds: [
      buildAccountEmbed(account, { title: `🔁 Replace — ${account.label}` })
        .setColor(BRAND.pendingColor)
        .setDescription('Status akun lama: `replacing`. Tekan **Isi Data Pengganti** untuk memasukkan akun/instance baru.'),
    ],
    components: [replaceProgressButtons(account.id)],
  };
}

const NO_ACTION_STATUSES = ['REPLACED', 'DISABLED'] as const;

async function handlePanelButton(interaction: ButtonInteraction, base: string, guildId: string) {
  switch (base) {
    case CustomId.RF_PANEL_REGISTER:
      await interaction.showModal(buildRedfingerRegisterModal()); // harus jadi respons pertama
      return;

    case CustomId.RF_PANEL_ADD:
      await interaction.showModal(buildRedfingerAddModal());
      return;

    case CustomId.RF_PANEL_LIST: {
      await interaction.deferReply({ ephemeral: true });
      const logins = await buildLoginsEmbed(guildId);
      await interaction.editReply({ embeds: [...(logins ? [logins] : []), await buildListEmbed(guildId, null)] });
      return;
    }

    case CustomId.RF_PANEL_SETUP:
      await interaction.deferReply({ ephemeral: true });
      await interaction.editReply({ embeds: [await buildSetupEmbed(guildId)] });
      return;

    case CustomId.RF_PANEL_MANAGE: {
      await interaction.deferReply({ ephemeral: true });
      const picker = await buildAccountPicker(guildId);
      await interaction.editReply(picker ?? { embeds: [errorEmbed('Belum ada device. Tekan **Register** untuk login akun Redfinger.')] });
      return;
    }

    case CustomId.RF_PANEL_RENEW:
    case CustomId.RF_PANEL_REPLACE: {
      await interaction.deferReply({ ephemeral: true });
      const renew = base === CustomId.RF_PANEL_RENEW;
      const picker = await buildAccountPicker(guildId, {
        customId: renew ? CustomId.RF_PICK_RENEW : CustomId.RF_PICK_REPLACE,
        placeholder: renew ? 'Pilih device yang akan di-renew...' : 'Pilih device yang akan diganti...',
        excludeStatuses: [...NO_ACTION_STATUSES],
      });
      await interaction.editReply(picker ?? { embeds: [errorEmbed('Belum ada device aktif. Tekan **Register** untuk login akun Redfinger.')] });
      return;
    }

    case CustomId.RF_PANEL_REDEEM: {
      await interaction.deferReply({ ephemeral: true });
      const picker = await buildLoginPicker(guildId, CustomId.RF_PICK_SYNC, 'Sudah redeem di Redfinger? Pilih akun untuk sinkron...');
      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setColor(BRAND.pendingColor)
            .setTitle('🎟️ Redeem Code')
            .setDescription(
              [
                'Redeem kode otomatis **belum aktif**. Halaman Redeem Code Redfinger sedang dipelajari dari hasil Register pertama, karena kode hanya bisa dipakai sekali sehingga bot tidak boleh menebak.',
                '',
                '**Sementara ini:** masukkan kode di Redfinger (menu *Redeem Code*), lalu pilih akunnya di bawah supaya device baru langsung tersinkron ke bot.',
              ].join('\n')
            ),
        ],
        components: picker?.components ?? [],
      });
      return;
    }

    case CustomId.RF_PANEL_LOGOUT: {
      await interaction.deferReply({ ephemeral: true });
      const picker = await buildLoginPicker(guildId, CustomId.RF_PICK_LOGOUT, 'Pilih akun login yang akan di-logout...');
      await interaction.editReply(picker ?? { embeds: [errorEmbed('Belum ada akun login Redfinger.')] });
      return;
    }

    case CustomId.RF_PANEL_RETRY: {
      await interaction.deferReply({ ephemeral: true });
      const logins = (await loginsNeedingRetry(guildId)).slice(0, 5);
      if (logins.length === 0) {
        await interaction.editReply({ embeds: [successEmbed('Tidak ada tugas yang gagal. Semua akun login dalam kondisi OK.')] });
        return;
      }
      await interaction.editReply({ embeds: [baseEmbed().setDescription(`⏳ Mengulang ${logins.length} tugas sinkron... (sekitar 30-60 detik per akun)`)] });
      const embeds = [];
      for (const login of logins) {
        const summary = await runLoginSync(interaction.client, login.id, interaction.user.id, {
          notify: (payload) => interaction.editReply(payload),
        });
        if (summary) embeds.push(await syncResultEmbed(summary));
      }
      await interaction.editReply({ embeds: embeds.slice(0, 10), components: [] });
      return;
    }
  }
}

export async function handleRedfingerButton(interaction: MessageComponentInteraction, base: string, args: string[]) {
  if (!(interaction.member instanceof GuildMember) || !(await isRedfingerAdmin(interaction.member))) {
    await interaction.reply({ embeds: [errorEmbed('Hanya admin Redfinger yang dapat memakai tombol ini.')], ephemeral: true });
    return;
  }
  const guildId = interaction.guildId;
  if (!guildId) return;

  if (base === CustomId.RF_DELETE_CANCEL) {
    await interaction.update({ embeds: [successEmbed('Dibatalkan. Tidak ada data yang diubah.')], components: [] });
    return;
  }

  // ===== Tombol panel (tanpa akun) =====
  if (base.startsWith('rf_panel_')) {
    await handlePanelButton(interaction as ButtonInteraction, base, guildId);
    // Perbarui statistik di pesan panel (kalau tombol ditekan dari panel). Gagal = abaikan.
    const msg = (interaction as ButtonInteraction).message;
    if (msg?.embeds[0]?.title?.includes('Redfinger') && msg.author.id === interaction.client.user.id) {
      void managerStats(guildId)
        .then((stats) => msg.edit(buildRedfingerPanel(stats)))
        .catch(() => {});
    }
    return;
  }

  if (base === CustomId.RF_LOGOUT_CONFIRM) {
    if (args[1] !== interaction.user.id) {
      await interaction.reply({ embeds: [errorEmbed('Konfirmasi ini hanya untuk admin yang meminta logout.')], ephemeral: true });
      return;
    }
    const login = await prisma.redfingerLogin.findFirst({ where: { id: args[0], guildId } });
    if (!login) {
      await interaction.update({ embeds: [errorEmbed('Akun login sudah tidak ada.')], components: [] });
      return;
    }
    await interaction.update({
      embeds: [successEmbed(`Logout ${maskIdentifier(login.email)} berhasil. Password terenkripsinya sudah dihapus dari bot.`)],
      components: [],
    });
    await logoutLogin(interaction.client, login, interaction.user.id);
    return;
  }

  // ===== Verifikasi perangkat baru Redfinger (args[0] = id tugas) =====
  if (base === CustomId.RF_VSEND || base === CustomId.RF_VCODE || base === CustomId.RF_VCANCEL) {
    const taskId = args[0] ?? '';
    if (base === CustomId.RF_VCODE) {
      if (!isWaiting(taskId, 'code')) {
        await interaction.reply({ embeds: [errorEmbed('Sesi verifikasi ini sudah tidak aktif. Ulangi lewat **Retry Tasks**.')], ephemeral: true });
        return;
      }
      await interaction.showModal(buildRedfingerVerifyCodeModal(taskId));
      return;
    }
    if (base === CustomId.RF_VSEND) {
      const ok = approveSend(taskId);
      await interaction.update({
        embeds: [ok ? baseEmbed().setDescription('📧 Meminta Redfinger mengirim kode verifikasi ke email... tunggu sebentar.') : errorEmbed('Sesi verifikasi ini sudah tidak aktif. Ulangi lewat **Retry Tasks**.')],
        components: [],
      });
      return;
    }
    cancelVerification(taskId);
    await interaction.update({ embeds: [successEmbed('Verifikasi dibatalkan.')], components: [] });
    return;
  }

  // ===== Replace otomatis: tombol Ganti Spesifikasi / konfirmasi / batal (args[0] = id sesi) =====
  if (base === CustomId.RF_RPL_GO || base === CustomId.RF_RPL_YES || base === CustomId.RF_RPL_CANCEL) {
    const session = getReplaceSession(args[0] ?? '');
    if (!session || session.guildId !== guildId) {
      await interaction.update({ embeds: [errorEmbed('Sesi replace sudah kedaluwarsa. Tekan **Replace** di panel lagi.')], components: [] });
      return;
    }
    if (session.userId !== interaction.user.id) {
      await interaction.reply({ embeds: [errorEmbed('Sesi replace ini milik admin lain.')], ephemeral: true });
      return;
    }
    if (base === CustomId.RF_RPL_CANCEL) {
      endReplaceSession(session.id);
      await interaction.update({ embeds: [successEmbed('Replace dibatalkan. Tidak ada perubahan di Redfinger.')], components: [] });
      return;
    }
    if (session.chosen === null) {
      await interaction.reply({ embeds: [errorEmbed('Pilih region & ROM tujuan dulu.')], ephemeral: true });
      return;
    }
    if (base === CustomId.RF_RPL_GO) {
      await interaction.update(replaceConfirmView(session));
      return;
    }

    // RF_RPL_YES → jalankan replace
    const target = session.choices[session.chosen];
    endReplaceSession(session.id);
    const acc = await prisma.redfingerAccount.findFirst({ where: { id: session.accountId, guildId } });
    if (!acc) {
      await interaction.update({ embeds: [errorEmbed('Device sudah tidak ada.')], components: [] });
      return;
    }
    await interaction.update({
      embeds: [progressEmbed(`⏳ **[PROSES]** Menjalankan replace **${acc.label}** → ${regionFlag(target.server)} **${target.server} · Android ${target.version}** di Redfinger... (±1 menit)`)],
      components: [],
    });
    const summary = await runReplace(interaction.client, acc, { version: target.version, server: target.server }, interaction.user.id);
    await interaction.editReply({
      embeds: [
        summary.ok && summary.account
          ? buildAccountEmbed(summary.account, { full: true, title: `✅ Replace berhasil — ${summary.account.label}` })
              .setColor(BRAND.successColor)
              .setDescription(`\`${summary.oldCode}\` → \`${summary.newCode}\` · ${regionFlag(target.server)} **${target.server} · Android ${target.version}**`)
          : errorEmbed(`Replace **${acc.label}** gagal: ${summary.message}\n\nStatus device dikembalikan; tidak ada yang berubah di bot.`),
      ],
      components: [],
    });
    return;
  }

  const account = args[0] ? await findAccount(guildId, args[0]) : null;
  if (!account) {
    await interaction.reply({ embeds: [errorEmbed('Akun Redfinger tidak ditemukan (mungkin sudah dihapus).')], ephemeral: true });
    return;
  }
  const actorId = interaction.user.id;
  const client = interaction.client;

  switch (base) {
    case CustomId.RF_RENEW:
    case CustomId.RF_RECHECK: {
      // Tombol dari notifikasi bisa ditekan lagi setelah renew sudah dimulai - tampilkan checklist lagi saja.
      if (base === CustomId.RF_RENEW && account.status === 'RENEWING') {
        await interaction.reply({ embeds: [renewChecklistEmbed(account)], components: [renewProgressButtons(account.id)], ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const res = await startRenew(client, account, actorId, base === CustomId.RF_RECHECK ? 'browser' : null);
      if (!res.ok) {
        await interaction.editReply({ embeds: [errorEmbed(res.error)] });
        return;
      }
      await interaction.editReply(renewStartedReply(res.value.account, res.value.mode, res.value.job.id, res.note));
      return;
    }

    case CustomId.RF_REPLACE: {
      await interaction.deferReply({ ephemeral: true });

      // Device hasil sinkron Register → replace otomatis langsung di Redfinger (pilih region & ROM).
      if (account.loginId && account.instanceId) {
        if (account.status === 'DISABLED' || account.status === 'REPLACED') {
          await interaction.editReply({ embeds: [errorEmbed(`Device berstatus ${statusText(account.status)} - tidak bisa di-replace.`)] });
          return;
        }
        await interaction.editReply({
          embeds: [progressEmbed(`⏳ **[PROSES]** Mengambil pilihan region & ROM dari Redfinger untuk **${account.label}** (\`${account.instanceId}\`)... (±30 detik)`)],
        });
        const res = await fetchReplaceOptions(account);
        if (res.kind !== 'ok') {
          await interaction.editReply({ embeds: [errorEmbed(`Gagal mengambil opsi replace: ${res.message}`)] });
          return;
        }
        if (res.options.versions.every((v) => v.servers.length === 0)) {
          await interaction.editReply({ embeds: [errorEmbed('Redfinger tidak menawarkan region/ROM tujuan untuk device ini saat ini.')] });
          return;
        }
        const fresh = (await prisma.redfingerAccount.findUnique({ where: { id: account.id } })) ?? account;
        const session = createReplaceSession(fresh, actorId, res.options);
        await interaction.editReply(replaceSessionView(session, fresh));
        return;
      }

      // Device manual (tanpa login) → alur lama: isi data akun/instance pengganti.
      const res = await startReplace(client, account, actorId);
      if (!res.ok) {
        await interaction.editReply({ embeds: [errorEmbed(res.error)] });
        return;
      }
      await interaction.editReply(replaceStartedReply(res.value, res.note));
      return;
    }

    case CustomId.RF_DONE: {
      if (account.status === 'REPLACING') {
        await interaction.reply({
          embeds: [errorEmbed('Akun ini sedang proses replace. Pakai **Isi Data Pengganti**, atau **Batalkan** replace dulu.')],
          components: [replaceProgressButtons(account.id)],
          ephemeral: true,
        });
        return;
      }
      if (!ACTIONABLE_STATUSES.includes(account.status)) {
        await interaction.reply({ embeds: [errorEmbed(`Akun berstatus ${statusText(account.status)} - tidak bisa ditandai selesai.`)], ephemeral: true });
        return;
      }
      // showModal harus jadi respons pertama.
      await interaction.showModal(buildRedfingerDueModal(account));
      return;
    }

    case CustomId.RF_REPLACE_FORM: {
      if (account.status !== 'REPLACING') {
        await interaction.reply({
          embeds: [errorEmbed(`Akun berstatus ${statusText(account.status)}, bukan \`replacing\`. Mulai lagi dengan \`/redfinger replace\`.`)],
          ephemeral: true,
        });
        return;
      }
      await interaction.showModal(buildRedfingerReplaceModal(account));
      return;
    }

    case CustomId.RF_FAIL: {
      await interaction.deferReply({ ephemeral: true });
      const res = await markProcessFailed(client, account, actorId);
      await interaction.editReply({ embeds: [res.ok ? successEmbed(`\`${account.code}\` ditandai \`failed\`. Admin sudah diberi tahu.`) : errorEmbed(res.error)] });
      return;
    }

    case CustomId.RF_CANCEL: {
      await interaction.deferReply({ ephemeral: true });
      const res = await cancelProcess(client, account, actorId);
      await interaction.editReply({
        embeds: [res.ok ? successEmbed(`Proses \`${account.code}\` dibatalkan. Status sekarang ${statusText(res.value.status)}.`) : errorEmbed(res.error)],
      });
      return;
    }

    case CustomId.RF_DELETE:
      await interaction.reply({ ...deleteConfirmMessage(account, actorId), ephemeral: true });
      return;

    case CustomId.RF_PASSWORD:
      await interaction.showModal(buildRedfingerPasswordModal(account));
      return;

    case CustomId.RF_DISABLE:
    case CustomId.RF_ENABLE: {
      await interaction.deferReply({ ephemeral: true });
      const res = await setAccountDisabled(client, account, actorId, base === CustomId.RF_DISABLE);
      await interaction.editReply({
        embeds: [res.ok ? successEmbed(`\`${account.code}\` sekarang ${statusText(res.value.status)}.`) : errorEmbed(res.error)],
      });
      return;
    }

    case CustomId.RF_DELETE_CONFIRM: {
      // Hanya admin yang menjalankan /redfinger delete yang boleh mengonfirmasi.
      if (args[1] !== actorId) {
        await interaction.reply({ embeds: [errorEmbed('Konfirmasi ini hanya untuk admin yang menjalankan perintah hapus.')], ephemeral: true });
        return;
      }
      await prisma.redfingerAccount.delete({ where: { id: account.id } });
      await interaction.update({ embeds: [successEmbed(`Akun **${account.label}** (\`${account.code}\`) dihapus permanen.`)], components: [] });
      await logRedfingerAction(client, {
        guildId,
        accountId: account.id,
        action: 'DELETE',
        title: '🗑️ Akun Redfinger dihapus',
        message: `**${account.label}** (\`${account.code}\`) dihapus permanen beserta riwayat pengingat & job-nya. Audit log tetap disimpan.`,
        actorId,
        color: BRAND.errorColor,
      });
      return;
    }

    default:
      return;
  }
}

/** Select menu "Kelola Akun" di panel: tampilkan detail + tombol aksi akun yang dipilih. */
export async function handleRedfingerSelect(interaction: StringSelectMenuInteraction) {
  if (!(interaction.member instanceof GuildMember) || !(await isRedfingerAdmin(interaction.member))) {
    await interaction.reply({ embeds: [errorEmbed('Hanya admin Redfinger yang dapat memakai menu ini.')], ephemeral: true });
    return;
  }
  const guildId = interaction.guildId;
  if (!guildId) return;
  const value = interaction.values[0] ?? '';

  // Renew / Replace dari panel: pakai alur yang sama persis dengan tombol di notifikasi.
  // Pilih region · Android pada sesi replace otomatis
  if (interaction.customId.startsWith(`${CustomId.RF_RPL_OPT}:`)) {
    const [, sessionId] = interaction.customId.split(':');
    const session = getReplaceSession(sessionId ?? '');
    if (!session || session.userId !== interaction.user.id) {
      await interaction.update({ embeds: [errorEmbed('Sesi replace sudah kedaluwarsa. Tekan **Replace** di panel lagi.')], components: [] });
      return;
    }
    const index = Number(value);
    if (Number.isInteger(index) && index >= 0 && index < session.choices.length) session.chosen = index;
    const acc = await prisma.redfingerAccount.findFirst({ where: { id: session.accountId, guildId } });
    if (!acc) {
      await interaction.update({ embeds: [errorEmbed('Device sudah tidak ada.')], components: [] });
      return;
    }
    await interaction.update(replaceSessionView(session, acc));
    return;
  }

  if (interaction.customId === CustomId.RF_PICK_RENEW || interaction.customId === CustomId.RF_PICK_REPLACE) {
    await handleRedfingerButton(interaction, interaction.customId === CustomId.RF_PICK_RENEW ? CustomId.RF_RENEW : CustomId.RF_REPLACE, [value]);
    return;
  }

  if (interaction.customId === CustomId.RF_PICK_LOGOUT || interaction.customId === CustomId.RF_PICK_SYNC) {
    const login = await prisma.redfingerLogin.findFirst({ where: { id: value, guildId } });
    if (!login) {
      await interaction.reply({ embeds: [errorEmbed('Akun login tidak ditemukan (mungkin sudah logout).')], ephemeral: true });
      return;
    }

    if (interaction.customId === CustomId.RF_PICK_LOGOUT) {
      const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildCustomId(CustomId.RF_LOGOUT_CONFIRM, login.id, interaction.user.id))
          .setLabel('Ya, logout & hapus password')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(CustomId.RF_DELETE_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Secondary)
      );
      await interaction.reply({
        embeds: [
          baseEmbed()
            .setColor(BRAND.errorColor)
            .setTitle(`🚪 Logout ${maskIdentifier(login.email)}?`)
            .setDescription(
              `Email & password terenkripsi akun ini akan **dihapus dari bot**. ${login.deviceCount} device yang sudah tercatat tetap ada (tidak disinkron otomatis lagi).`
            ),
        ],
        components: [buttons],
        ephemeral: true,
      });
      return;
    }

    // Sinkron sekarang (mis. setelah redeem manual di Redfinger)
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({ embeds: [baseEmbed().setDescription(`⏳ Login & sinkron ${maskIdentifier(login.email)}... (sekitar 30-60 detik)`)] });
    const summary = await runLoginSync(interaction.client, login.id, interaction.user.id, { notify: (payload) => interaction.editReply(payload) });
    await interaction.editReply({ embeds: [summary ? await syncResultEmbed(summary) : errorEmbed('Sinkron gagal dijalankan. Cek log bot.')], components: [] });
    return;
  }

  await interaction.deferUpdate();
  const account = await findAccount(guildId, value);
  if (!account) {
    await interaction.editReply({ content: null, embeds: [errorEmbed('Akun tidak ditemukan (mungkin sudah dihapus).')], components: [] });
    return;
  }

  // Dropdown tetap ada di atas supaya bisa langsung pindah ke akun lain.
  const picker = await buildAccountPicker(guildId);
  await interaction.editReply({
    content: null,
    embeds: [await buildDetailEmbed(account)],
    components: [...(picker?.components ?? []), ...manageButtons(account)],
    allowedMentions: { parse: [] },
  });
}
