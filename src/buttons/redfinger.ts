import { ButtonInteraction, GuildMember, StringSelectMenuInteraction } from 'discord.js';
import { RedfingerAccount } from '@prisma/client';
import { CustomId } from '../types/customIds';
import { prisma } from '../database/prisma';
import { isRedfingerAdmin } from '../utils/permissions';
import { errorEmbed, successEmbed, baseEmbed } from '../utils/embeds';
import { BRAND } from '../config/config';
import { ACTIONABLE_STATUSES, buildAccountEmbed, findAccount, statusText } from '../services/redfinger/accountService';
import { logRedfingerAction, renewProgressButtons, replaceProgressButtons } from '../services/redfinger/notify';
import { cancelProcess, markProcessFailed, renewChecklistEmbed, setAccountDisabled, startRenew, startReplace } from '../services/redfinger/workflow';
import { buildAccountPicker, buildDetailEmbed, buildListEmbed, buildSetupEmbed, deleteConfirmMessage, manageButtons } from '../services/redfinger/views';
import {
  buildRedfingerAddModal,
  buildRedfingerDueModal,
  buildRedfingerPasswordModal,
  buildRedfingerReplaceModal,
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

export async function handleRedfingerButton(interaction: ButtonInteraction, base: string, args: string[]) {
  if (!(interaction.member instanceof GuildMember) || !(await isRedfingerAdmin(interaction.member))) {
    await interaction.reply({ embeds: [errorEmbed('Hanya admin Redfinger yang dapat memakai tombol ini.')], ephemeral: true });
    return;
  }
  const guildId = interaction.guildId;
  if (!guildId) return;

  if (base === CustomId.RF_DELETE_CANCEL) {
    await interaction.update({ embeds: [successEmbed('Penghapusan dibatalkan. Tidak ada data yang diubah.')], components: [] });
    return;
  }

  // ===== Tombol panel (tanpa akun) =====
  switch (base) {
    case CustomId.RF_PANEL_ADD:
      await interaction.showModal(buildRedfingerAddModal()); // harus jadi respons pertama
      return;
    case CustomId.RF_PANEL_LIST:
      await interaction.deferReply({ ephemeral: true });
      await interaction.editReply({ embeds: [await buildListEmbed(guildId, null)] });
      return;
    case CustomId.RF_PANEL_SETUP:
      await interaction.deferReply({ ephemeral: true });
      await interaction.editReply({ embeds: [await buildSetupEmbed(guildId)] });
      return;
    case CustomId.RF_PANEL_MANAGE: {
      await interaction.deferReply({ ephemeral: true });
      const picker = await buildAccountPicker(guildId);
      await interaction.editReply(
        picker ?? { embeds: [errorEmbed('Belum ada akun Redfinger. Tambahkan lewat tombol **Tambah Akun**.')] }
      );
      return;
    }
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

  await interaction.deferUpdate();
  const account = await findAccount(guildId, interaction.values[0] ?? '');
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
