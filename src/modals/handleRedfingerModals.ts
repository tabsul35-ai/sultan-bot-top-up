import { GuildMember, ModalSubmitInteraction } from 'discord.js';
import { CustomId } from '../types/customIds';
import { prisma } from '../database/prisma';
import { isRedfingerAdmin } from '../utils/permissions';
import { errorEmbed, successEmbed } from '../utils/embeds';
import { BRAND } from '../config/config';
import { buildAccountEmbed, createAccount, findAccount, timeBasedStatus } from '../services/redfinger/accountService';
import { encryptSecret, isEncryptionConfigured } from '../services/redfinger/crypto';
import { dateInputHint, parseDateInput } from '../services/redfinger/dates';
import { logRedfingerAction } from '../services/redfinger/notify';
import { completeRenew, completeReplace } from '../services/redfinger/workflow';

function optionalField(interaction: ModalSubmitInteraction, id: string): string | null {
  try {
    const value = interaction.fields.getTextInputValue(id).trim();
    return value || null;
  } catch {
    return null;
  }
}

/** Instance ID yang sama tidak boleh dipakai dua akun aktif sekaligus di satu guild. */
async function instanceTaken(guildId: string, instanceId: string | null, exceptId?: string) {
  if (!instanceId) return null;
  return prisma.redfingerAccount.findFirst({
    where: {
      guildId,
      instanceId: { equals: instanceId, mode: 'insensitive' },
      status: { not: 'REPLACED' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });
}

/**
 * Enkripsi password kalau diisi. Return { value } atau { warning } kalau kunci enkripsi belum
 * diatur (akun tetap disimpan TANPA password - tidak pernah disimpan plaintext).
 */
function preparePassword(plain: string | null): { value: string | null; warning?: string } {
  if (!plain) return { value: null };
  if (!isEncryptionConfigured()) {
    return { value: null, warning: '⚠️ Password **tidak disimpan** karena `REDFINGER_ENCRYPTION_KEY` belum diatur di .env.' };
  }
  return { value: encryptSecret(plain) };
}

export async function handleRedfingerModalSubmit(interaction: ModalSubmitInteraction, base: string, args: string[]) {
  if (!(interaction.member instanceof GuildMember) || !(await isRedfingerAdmin(interaction.member))) {
    await interaction.reply({ embeds: [errorEmbed('Hanya admin Redfinger yang dapat melakukan ini.')], ephemeral: true });
    return;
  }
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ embeds: [errorEmbed('Hanya bisa digunakan di dalam server.')], ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const actorId = interaction.user.id;

  // ===== Tambah akun baru =====
  if (base === CustomId.RF_MODAL_ADD) {
    const label = interaction.fields.getTextInputValue(CustomId.RF_INPUT_LABEL).trim();
    const username = optionalField(interaction, CustomId.RF_INPUT_USERNAME);
    const instanceId = optionalField(interaction, CustomId.RF_INPUT_INSTANCE);
    const dueDate = parseDateInput(interaction.fields.getTextInputValue(CustomId.RF_INPUT_DUE));
    if (!dueDate) {
      await interaction.editReply({ embeds: [errorEmbed(`Tanggal jatuh tempo tidak valid. ${dateInputHint()}`)] });
      return;
    }

    const duplicate = await instanceTaken(guildId, instanceId);
    if (duplicate) {
      await interaction.editReply({ embeds: [errorEmbed(`Instance \`${instanceId}\` sudah terdaftar di \`${duplicate.code}\` (${duplicate.label}).`)] });
      return;
    }

    const password = preparePassword(optionalField(interaction, CustomId.RF_INPUT_PASSWORD));
    const startDate = args[0] ? new Date(Number(args[0]) * 1000) : new Date();

    const account = await createAccount({
      guildId,
      label,
      username,
      passwordEncrypted: password.value,
      instanceId,
      startDate,
      dueDate,
      status: timeBasedStatus(dueDate),
      createdById: actorId,
    });

    await logRedfingerAction(interaction.client, {
      guildId,
      accountId: account.id,
      action: 'ADD',
      title: '➕ Akun Redfinger ditambahkan',
      message: `**${account.label}** (\`${account.code}\`) didaftarkan${account.passwordEncrypted ? ' (dengan password terenkripsi)' : ''}.`,
      actorId,
    });

    await interaction.editReply({
      content: password.warning,
      embeds: [buildAccountEmbed(account, { full: true, title: `➕ Akun ditambahkan — ${account.label}` }).setColor(BRAND.successColor)],
    });
    return;
  }

  const account = args[0] ? await findAccount(guildId, args[0]) : null;
  if (!account) {
    await interaction.editReply({ embeds: [errorEmbed('Akun Redfinger tidak ditemukan (mungkin sudah dihapus).')] });
    return;
  }

  // ===== Renew selesai: jatuh tempo baru =====
  if (base === CustomId.RF_MODAL_DUE) {
    const raw = interaction.fields.getTextInputValue(CustomId.RF_INPUT_DUE);
    // "+30" dihitung dari jatuh tempo lama (kalau masih di depan) - perilaku perpanjangan yang lazim.
    const from = account.dueDate.getTime() > Date.now() ? account.dueDate : new Date();
    const newDue = parseDateInput(raw, from);
    if (!newDue) {
      await interaction.editReply({ embeds: [errorEmbed(`Tanggal tidak valid. ${dateInputHint()}`)] });
      return;
    }
    const note = optionalField(interaction, CustomId.RF_INPUT_NOTES);

    const res = await completeRenew(interaction.client, account, newDue, actorId, note ? `Catatan: ${note}` : undefined);
    if (!res.ok) {
      await interaction.editReply({ embeds: [errorEmbed(res.error)] });
      return;
    }
    await interaction.editReply({
      embeds: [buildAccountEmbed(res.value, { full: true, title: `✅ Renew selesai — ${res.value.label}` }).setColor(BRAND.successColor)],
    });
    return;
  }

  // ===== Data akun pengganti =====
  if (base === CustomId.RF_MODAL_REPLACE) {
    const dueDate = parseDateInput(interaction.fields.getTextInputValue(CustomId.RF_INPUT_DUE));
    if (!dueDate) {
      await interaction.editReply({ embeds: [errorEmbed(`Tanggal jatuh tempo tidak valid. ${dateInputHint()}`)] });
      return;
    }
    const instanceId = optionalField(interaction, CustomId.RF_INPUT_INSTANCE);
    const duplicate = await instanceTaken(guildId, instanceId, account.id);
    if (duplicate) {
      await interaction.editReply({ embeds: [errorEmbed(`Instance \`${instanceId}\` sudah terdaftar di \`${duplicate.code}\` (${duplicate.label}).`)] });
      return;
    }
    const password = preparePassword(optionalField(interaction, CustomId.RF_INPUT_PASSWORD));

    const res = await completeReplace(
      interaction.client,
      account,
      {
        label: interaction.fields.getTextInputValue(CustomId.RF_INPUT_LABEL).trim(),
        username: optionalField(interaction, CustomId.RF_INPUT_USERNAME),
        passwordEncrypted: password.value,
        instanceId,
        dueDate,
      },
      actorId
    );
    if (!res.ok) {
      await interaction.editReply({ embeds: [errorEmbed(res.error)] });
      return;
    }
    await interaction.editReply({
      content: password.warning,
      embeds: [
        successEmbed(`\`${account.code}\` (${account.label}) sekarang berstatus \`replaced\`.`),
        buildAccountEmbed(res.value, { full: true, title: `🔁 Akun pengganti — ${res.value.label}` }).setColor(BRAND.successColor),
      ],
    });
    return;
  }

  // ===== Ganti / hapus password =====
  if (base === CustomId.RF_MODAL_PASSWORD) {
    const plain = optionalField(interaction, CustomId.RF_INPUT_PASSWORD);
    if (plain && !isEncryptionConfigured()) {
      await interaction.editReply({ embeds: [errorEmbed('`REDFINGER_ENCRYPTION_KEY` belum diatur di .env - password tidak bisa disimpan.')] });
      return;
    }
    await prisma.redfingerAccount.update({
      where: { id: account.id },
      data: { passwordEncrypted: plain ? encryptSecret(plain) : null },
    });
    await logRedfingerAction(interaction.client, {
      guildId,
      accountId: account.id,
      action: 'PASSWORD_CHANGE',
      title: '🔑 Password diubah',
      message: `Password **${account.label}** (\`${account.code}\`) ${plain ? 'diperbarui' : 'dihapus'}.`,
      actorId,
    });
    await interaction.editReply({ embeds: [successEmbed(`Password \`${account.code}\` ${plain ? 'diperbarui (terenkripsi)' : 'dihapus'}.`)] });
    return;
  }
}
