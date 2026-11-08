import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { RedfingerAccount } from '@prisma/client';
import { CustomId, buildCustomId } from '../types/customIds';
import { formatDateInput, tzLabel } from '../services/redfinger/dates';

/**
 * Form popup Redfinger. Password hanya diketik di modal (tidak pernah lewat opsi slash command
 * atau pesan channel) dan balasannya selalu ephemeral.
 */

function row(input: TextInputBuilder) {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function labelInput(value?: string) {
  const input = new TextInputBuilder()
    .setCustomId(CustomId.RF_INPUT_LABEL)
    .setLabel('Nama/label akun')
    .setPlaceholder('Contoh: RF Farming 01')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(60)
    .setRequired(true);
  if (value) input.setValue(value.slice(0, 60));
  return input;
}

function usernameInput() {
  return new TextInputBuilder()
    .setCustomId(CustomId.RF_INPUT_USERNAME)
    .setLabel('Email/username login Redfinger (opsional)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(200)
    .setRequired(false);
}

function passwordInput(label = 'Password (opsional, disimpan terenkripsi)') {
  return new TextInputBuilder()
    .setCustomId(CustomId.RF_INPUT_PASSWORD)
    .setLabel(label)
    .setPlaceholder('Kosongkan kalau tidak perlu otomasi browser')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(256)
    .setRequired(false);
}

function instanceInput() {
  return new TextInputBuilder()
    .setCustomId(CustomId.RF_INPUT_INSTANCE)
    .setLabel('Instance/Device ID (opsional)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(false);
}

function dueInput(label: string, value?: string) {
  const input = new TextInputBuilder()
    .setCustomId(CustomId.RF_INPUT_DUE)
    .setLabel(label)
    .setPlaceholder(`YYYY-MM-DD [HH:mm] atau +30 (${tzLabel()})`)
    .setStyle(TextInputStyle.Short)
    .setMinLength(2)
    .setMaxLength(20)
    .setRequired(true);
  if (value) input.setValue(value);
  return input;
}

/** Register akun Redfinger (login email + password) - bot login & sinkron device otomatis. */
export function buildRedfingerRegisterModal(): ModalBuilder {
  const email = new TextInputBuilder()
    .setCustomId(CustomId.RF_INPUT_EMAIL)
    .setLabel('Email Akun Redfinger')
    .setPlaceholder('contoh@gmail.com')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(200)
    .setRequired(true);
  const password = new TextInputBuilder()
    .setCustomId(CustomId.RF_INPUT_PASSWORD)
    .setLabel('Password Akun Redfinger')
    .setPlaceholder('Disimpan terenkripsi, tidak pernah ditampilkan')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(256)
    .setRequired(true);
  return new ModalBuilder()
    .setCustomId(CustomId.RF_MODAL_REGISTER)
    .setTitle('Register Akun Redfinger')
    .addComponents(row(email), row(password));
}

/** Kode verifikasi perangkat baru dari email Redfinger. */
export function buildRedfingerVerifyCodeModal(taskId: string): ModalBuilder {
  const code = new TextInputBuilder()
    .setCustomId(CustomId.RF_INPUT_VCODE)
    .setLabel('Kode verifikasi dari email Redfinger')
    .setPlaceholder('contoh: 123456')
    .setStyle(TextInputStyle.Short)
    .setMinLength(4)
    .setMaxLength(12)
    .setRequired(true);
  return new ModalBuilder()
    .setCustomId(buildCustomId(CustomId.RF_MODAL_VCODE, taskId))
    .setTitle('Verifikasi Perangkat Redfinger')
    .addComponents(row(code));
}

/** /redfinger add - `startEpoch` (detik) dari opsi `mulai`, dibawa lewat customId. */
export function buildRedfingerAddModal(startEpoch?: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(startEpoch ? buildCustomId(CustomId.RF_MODAL_ADD, startEpoch) : CustomId.RF_MODAL_ADD)
    .setTitle('Tambah Akun Redfinger')
    .addComponents(
      row(labelInput()),
      row(usernameInput()),
      row(passwordInput()),
      row(instanceInput()),
      row(dueInput('Tanggal jatuh tempo'))
    );
}

/** Tandai renew selesai: isi jatuh tempo baru. */
export function buildRedfingerDueModal(account: RedfingerAccount): ModalBuilder {
  const notes = new TextInputBuilder()
    .setCustomId(CustomId.RF_INPUT_NOTES)
    .setLabel('Catatan renew (opsional, mis. paket/harga)')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(500)
    .setRequired(false);

  return new ModalBuilder()
    .setCustomId(buildCustomId(CustomId.RF_MODAL_DUE, account.id))
    .setTitle(`Renew selesai — ${account.code}`)
    .addComponents(
      row(dueInput(`Jatuh tempo BARU (lama: ${formatDateInput(account.dueDate)})`.slice(0, 45))),
      row(notes)
    );
}

/** Data akun/instance pengganti. */
export function buildRedfingerReplaceModal(account: RedfingerAccount): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildCustomId(CustomId.RF_MODAL_REPLACE, account.id))
    .setTitle(`Pengganti untuk ${account.code}`)
    .addComponents(
      row(labelInput(account.label)),
      row(usernameInput()),
      row(passwordInput()),
      row(instanceInput()),
      row(dueInput('Jatuh tempo akun pengganti'))
    );
}

/** Ganti/hapus password (dibuka dari /redfinger edit ganti_password:True). */
export function buildRedfingerPasswordModal(account: RedfingerAccount): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildCustomId(CustomId.RF_MODAL_PASSWORD, account.id))
    .setTitle(`Password — ${account.code}`)
    .addComponents(row(passwordInput('Password baru (kosongkan = hapus password)')));
}
