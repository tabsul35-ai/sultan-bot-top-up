import { Client, EmbedBuilder } from 'discord.js';
import { RedfingerAccount, RedfingerJob, RedfingerJobType } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { BRAND, redfingerConfig } from '../../config/config';
import { baseEmbed } from '../../utils/embeds';
import { ACTIONABLE_STATUSES, buildAccountEmbed, createAccount, statusText, timeBasedStatus } from './accountService';
import { browserAutomationStatus, enqueueBrowserJob, runBrowserRenewCheck } from './browserAutomation';
import { decryptSecret, isEncryptionConfigured } from './crypto';
import { formatDue } from './dates';
import { logRedfingerAction, reminderButtons, renewProgressButtons, sendAdminNotification } from './notify';

/**
 * Alur renew & replace akun Redfinger. Dipakai bersama oleh /redfinger (command) dan tombol
 * di notifikasi, supaya aturan status selalu sama dari mana pun aksi dipicu.
 *
 * Status akun:  ACTIVE/EXPIRING/EXPIRED/FAILED --renew--> RENEWING --selesai--> ACTIVE (dueDate baru)
 *                                                                  --gagal---> FAILED
 *               ... --replace--> REPLACING --data pengganti--> REPLACED (+ akun baru ACTIVE)
 * Setiap proses dicatat sebagai RedfingerJob (STARTED -> SUCCESS / FAILED / NEEDS_VERIFICATION / CANCELLED)
 * dan setiap perubahan masuk RedfingerAuditLog.
 */

export type WorkflowResult<T = undefined> = { ok: true; value: T; note?: string } | { ok: false; error: string };

const OPEN_JOB_STATUSES = ['STARTED', 'NEEDS_VERIFICATION'] as const;

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Kredensial untuk otomasi: dari login Register (kalau device hasil sinkron), atau dari device itu sendiri. */
async function credentialsFor(account: RedfingerAccount): Promise<{ username: string | null; passwordEncrypted: string | null }> {
  if (account.loginId) {
    const login = await prisma.redfingerLogin.findUnique({ where: { id: account.loginId } });
    if (login) return { username: login.email, passwordEncrypted: login.passwordEncrypted };
  }
  return { username: account.username, passwordEncrypted: account.passwordEncrypted };
}

async function closeOpenJobs(
  accountId: string,
  status: 'SUCCESS' | 'FAILED' | 'CANCELLED',
  message: string,
  type?: RedfingerJobType
): Promise<number> {
  const res = await prisma.redfingerJob.updateMany({
    where: { accountId, status: { in: [...OPEN_JOB_STATUSES] }, ...(type ? { type } : {}) },
    data: { status, message, finishedAt: new Date() },
  });
  return res.count;
}

export function renewChecklistEmbed(account: RedfingerAccount): EmbedBuilder {
  return baseEmbed()
    .setColor(BRAND.pendingColor)
    .setTitle(`🔄 Renew manual — ${account.label} (\`${account.code}\`)`)
    .setDescription(
      [
        `Status sekarang: ${statusText('RENEWING')} · Jatuh tempo lama: ${formatDue(account.dueDate)}`,
        '',
        '**Checklist:**',
        `1. Login ke Redfinger dengan akun **${account.label}**${account.username ? ` (\`${account.username}\`)` : ''}.`,
        `2. Buka device/instance${account.instanceId ? ` \`${account.instanceId}\`` : ''} → pilih **Renew/Perpanjang** → pilih paket.`,
        '3. Selesaikan pembayaran. CAPTCHA/OTP/verifikasi apa pun diselesaikan sendiri oleh admin.',
        '4. Catat **tanggal jatuh tempo baru** yang tampil di Redfinger.',
        '5. Tekan **Tandai Selesai** lalu isi tanggal itu (atau `+30` untuk 30 hari dari jatuh tempo lama).',
        '',
        'Kalau renew tidak bisa dilakukan, tekan **Tandai Gagal** atau **Batalkan**.',
      ].join('\n')
    );
}

/**
 * Mulai renew. `requestedMode` null = pakai REDFINGER_RENEW_MODE (dengan fallback ke manual
 * kalau browser tidak tersedia). Mode browser yang diminta eksplisit tapi tidak tersedia = error.
 */
export async function startRenew(
  client: Client,
  account: RedfingerAccount,
  actorId: string,
  requestedMode: 'manual' | 'browser' | null
): Promise<WorkflowResult<{ account: RedfingerAccount; job: RedfingerJob; mode: 'manual' | 'browser' }>> {
  if (!ACTIONABLE_STATUSES.includes(account.status)) {
    return fail(`Akun berstatus ${statusText(account.status)} - tidak bisa di-renew. ${account.status === 'DISABLED' ? 'Aktifkan dulu dengan `/redfinger enable`.' : ''}`);
  }

  let mode: 'manual' | 'browser' = requestedMode ?? redfingerConfig.renewMode;
  let note: string | undefined;

  if (mode === 'browser') {
    const availability = browserAutomationStatus();
    let problem = availability.available ? null : availability.reason!;
    const creds = await credentialsFor(account);
    if (!problem && !creds.username) problem = 'Email/username akun belum diisi (atau Register akun Redfinger-nya dulu).';
    if (!problem && !creds.passwordEncrypted) problem = 'Password belum disimpan (Register akun Redfinger, atau `/redfinger edit ganti_password:True`).';
    if (!problem && !isEncryptionConfigured()) problem = 'REDFINGER_ENCRYPTION_KEY belum diatur, password tidak bisa dibaca.';

    if (problem) {
      if (requestedMode === 'browser') return fail(`Mode browser tidak bisa dipakai: ${problem}`);
      mode = 'manual';
      note = `Mode browser tidak tersedia (${problem}) - memakai alur manual.`;
    }
  }

  // Satu job browser per akun sekaligus.
  const running = await prisma.redfingerJob.findFirst({ where: { accountId: account.id, mode: 'BROWSER', status: 'STARTED' } });
  if (running) return fail('Job browser untuk akun ini masih berjalan. Tunggu hasilnya dulu.');

  // Proses lain yang masih terbuka (mis. replace, atau renew sebelumnya) ditutup supaya riwayat jelas.
  await closeOpenJobs(account.id, 'CANCELLED', 'Digantikan oleh proses renew baru.');

  const updated = await prisma.redfingerAccount.update({ where: { id: account.id }, data: { status: 'RENEWING' } });
  const job = await prisma.redfingerJob.create({
    data: { guildId: account.guildId, accountId: account.id, type: 'RENEW', mode: mode === 'browser' ? 'BROWSER' : 'MANUAL', actorId },
  });

  await logRedfingerAction(client, {
    guildId: account.guildId,
    accountId: account.id,
    action: 'RENEW_START',
    title: '🔄 Renew dimulai',
    message: `Renew **${account.label}** (\`${account.code}\`) dimulai - mode **${mode}**. Job \`${job.id}\`: dimulai.`,
    actorId,
  });

  if (mode === 'browser') void runBrowserJob(client, job.id);

  return { ok: true, value: { account: updated, job, mode }, note };
}

/** Jalankan job browser (antri, 1 per waktu) lalu terapkan hasilnya. Tidak pernah melempar error. */
export async function runBrowserJob(client: Client, jobId: string): Promise<void> {
  try {
    await enqueueBrowserJob(async () => {
      const job = await prisma.redfingerJob.findUnique({ where: { id: jobId }, include: { account: true } });
      if (!job || job.status !== 'STARTED') return; // sudah dibatalkan admin saat mengantri

      const account = job.account;
      const creds = await credentialsFor(account);
      let password: string;
      try {
        password = decryptSecret(creds.passwordEncrypted ?? '');
      } catch (err) {
        await applyBrowserFailure(client, job.id, account, err instanceof Error ? err.message : 'Password tidak bisa dibaca.');
        return;
      }

      const result = await runBrowserRenewCheck({
        username: creds.username ?? '',
        password,
        instanceId: account.instanceId,
        currentDueDate: account.dueDate,
      });

      // Admin mungkin membatalkan/menyelesaikan manual saat browser berjalan - jangan timpa.
      const fresh = await prisma.redfingerJob.findUnique({ where: { id: job.id } });
      if (!fresh || fresh.status !== 'STARTED') return;

      if (result.kind === 'success') {
        await prisma.redfingerJob.update({ where: { id: job.id }, data: { status: 'SUCCESS', message: result.message, finishedAt: new Date() } });
        const current = (await prisma.redfingerAccount.findUnique({ where: { id: account.id } })) ?? account;
        const res = await completeRenew(client, current, result.dueDate, null, `Otomatis via browser (job ${job.id}).`);
        if (res.ok) {
          await sendAdminNotification(client, account.guildId, {
            embeds: [buildAccountEmbed(res.value, { title: `✅ Renew berhasil (browser) — ${account.label}` }).setColor(BRAND.successColor)],
          });
        }
        return;
      }

      if (result.kind === 'needs_verification') {
        await prisma.redfingerJob.update({ where: { id: job.id }, data: { status: 'NEEDS_VERIFICATION', message: result.message } });
        await logRedfingerAction(client, {
          guildId: account.guildId,
          accountId: account.id,
          action: 'JOB_NEEDS_VERIFICATION',
          title: '🛂 Perlu verifikasi manual',
          message: `Job \`${job.id}\` (${account.code}): ${result.message}`,
          color: BRAND.pendingColor,
        });
        await sendAdminNotification(client, account.guildId, {
          mentionRole: true,
          embeds: [
            buildAccountEmbed(account, { title: `🛂 Renew perlu tindakan manual — ${account.label}` })
              .setColor(BRAND.pendingColor)
              .setDescription(`${result.message}\n\nBot menunggu tindakan admin. Bot tidak mencoba melewati CAPTCHA/OTP/MFA.`),
          ],
          components: [renewProgressButtons(account.id, { recheck: true })],
        });
        return;
      }

      await applyBrowserFailure(client, job.id, account, result.message);
    });
  } catch (err) {
    console.error('[redfinger] Job browser error tak terduga:', err);
  }
}

async function applyBrowserFailure(client: Client, jobId: string, account: RedfingerAccount, message: string) {
  await prisma.redfingerJob.update({ where: { id: jobId }, data: { status: 'FAILED', message, finishedAt: new Date() } });
  const updated = await prisma.redfingerAccount.update({ where: { id: account.id }, data: { status: 'FAILED' } });
  await logRedfingerAction(client, {
    guildId: account.guildId,
    accountId: account.id,
    action: 'JOB_FAILED',
    title: '❌ Job renew gagal',
    message: `Job \`${jobId}\` (${account.code}) gagal: ${message}`,
    color: BRAND.errorColor,
  });
  await sendAdminNotification(client, account.guildId, {
    mentionRole: true,
    embeds: [
      buildAccountEmbed(updated, { title: `❌ Renew gagal — ${account.label}` })
        .setColor(BRAND.errorColor)
        .setDescription(`${message}\n\nCoba lagi (Renew), ganti akun (Replace), atau selesaikan manual lalu Tandai Selesai.`),
    ],
    components: [reminderButtons(account.id)],
  });
}

/** Renew selesai: set jatuh tempo baru, status kembali sesuai waktu (biasanya ACTIVE). */
export async function completeRenew(
  client: Client,
  account: RedfingerAccount,
  newDueDate: Date,
  actorId: string | null,
  note?: string
): Promise<WorkflowResult<RedfingerAccount>> {
  if (!ACTIONABLE_STATUSES.includes(account.status)) {
    return fail(`Akun berstatus ${statusText(account.status)} - tidak bisa ditandai selesai renew.`);
  }
  if (newDueDate.getTime() <= Date.now()) return fail('Tanggal jatuh tempo baru harus di masa depan.');

  const updated = await prisma.redfingerAccount.update({
    where: { id: account.id },
    data: { dueDate: newDueDate, status: timeBasedStatus(newDueDate) },
  });
  await closeOpenJobs(account.id, 'SUCCESS', note ?? 'Ditandai selesai oleh admin.', 'RENEW');

  await logRedfingerAction(client, {
    guildId: account.guildId,
    accountId: account.id,
    action: 'RENEW_SUCCESS',
    title: '✅ Renew berhasil',
    message: `**${account.label}** (\`${account.code}\`) diperpanjang.\nJatuh tempo: ${formatDue(account.dueDate)} → ${formatDue(newDueDate)}${
      note ? `\n${note}` : ''
    }`,
    actorId,
    color: BRAND.successColor,
  });
  return { ok: true, value: updated };
}

/** Tandai proses renew/replace yang sedang berjalan sebagai gagal. */
export async function markProcessFailed(
  client: Client,
  account: RedfingerAccount,
  actorId: string,
  reason = 'Ditandai gagal oleh admin.'
): Promise<WorkflowResult<RedfingerAccount>> {
  if (account.status !== 'RENEWING' && account.status !== 'REPLACING') {
    return fail(`Tidak ada proses renew/replace yang berjalan (status ${statusText(account.status)}).`);
  }
  const process = account.status === 'RENEWING' ? 'Renew' : 'Replace';
  const updated = await prisma.redfingerAccount.update({ where: { id: account.id }, data: { status: 'FAILED' } });
  await closeOpenJobs(account.id, 'FAILED', reason);

  await logRedfingerAction(client, {
    guildId: account.guildId,
    accountId: account.id,
    action: 'JOB_FAILED',
    title: `❌ ${process} gagal`,
    message: `${process} **${account.label}** (\`${account.code}\`) gagal: ${reason}`,
    actorId,
    color: BRAND.errorColor,
  });
  await sendAdminNotification(client, account.guildId, {
    mentionRole: true,
    embeds: [buildAccountEmbed(updated, { title: `❌ ${process} gagal — ${account.label}` }).setColor(BRAND.errorColor)],
    components: [reminderButtons(account.id)],
  });
  return { ok: true, value: updated };
}

/** Batalkan proses renew/replace - status kembali sesuai jatuh tempo. */
export async function cancelProcess(client: Client, account: RedfingerAccount, actorId: string): Promise<WorkflowResult<RedfingerAccount>> {
  if (account.status !== 'RENEWING' && account.status !== 'REPLACING') {
    return fail(`Tidak ada proses renew/replace yang berjalan (status ${statusText(account.status)}).`);
  }
  const updated = await prisma.redfingerAccount.update({ where: { id: account.id }, data: { status: timeBasedStatus(account.dueDate) } });
  await closeOpenJobs(account.id, 'CANCELLED', 'Dibatalkan admin.');

  await logRedfingerAction(client, {
    guildId: account.guildId,
    accountId: account.id,
    action: 'PROCESS_CANCELLED',
    title: '↩️ Proses dibatalkan',
    message: `Proses ${account.status === 'RENEWING' ? 'renew' : 'replace'} **${account.label}** (\`${account.code}\`) dibatalkan. Status sekarang ${statusText(updated.status)}.`,
    actorId,
  });
  return { ok: true, value: updated };
}

/** Mulai replace: status lama -> REPLACING, menunggu admin mengisi data pengganti. */
export async function startReplace(client: Client, account: RedfingerAccount, actorId: string): Promise<WorkflowResult<RedfingerAccount>> {
  if (account.status === 'REPLACING') return { ok: true, value: account, note: 'Proses replace sudah berjalan.' };
  if (!ACTIONABLE_STATUSES.includes(account.status)) {
    return fail(`Akun berstatus ${statusText(account.status)} - tidak bisa diganti.`);
  }

  const running = await prisma.redfingerJob.findFirst({ where: { accountId: account.id, mode: 'BROWSER', status: 'STARTED' } });
  if (running) return fail('Job browser renew untuk akun ini masih berjalan. Tunggu hasilnya atau batalkan dulu.');

  await closeOpenJobs(account.id, 'CANCELLED', 'Digantikan oleh proses replace.');
  const updated = await prisma.redfingerAccount.update({ where: { id: account.id }, data: { status: 'REPLACING' } });
  const job = await prisma.redfingerJob.create({
    data: { guildId: account.guildId, accountId: account.id, type: 'REPLACE', mode: 'MANUAL', actorId },
  });

  await logRedfingerAction(client, {
    guildId: account.guildId,
    accountId: account.id,
    action: 'REPLACE_START',
    title: '🔁 Replace dimulai',
    message: `Replace **${account.label}** (\`${account.code}\`) dimulai. Job \`${job.id}\`: menunggu data akun/instance pengganti.`,
    actorId,
  });
  return { ok: true, value: updated };
}

/** Selesaikan replace: buat akun pengganti, akun lama -> REPLACED. */
export async function completeReplace(
  client: Client,
  oldAccount: RedfingerAccount,
  data: { label: string; username: string | null; passwordEncrypted: string | null; instanceId: string | null; dueDate: Date },
  actorId: string
): Promise<WorkflowResult<RedfingerAccount>> {
  if (oldAccount.status !== 'REPLACING') {
    return fail(`Akun lama berstatus ${statusText(oldAccount.status)}, bukan \`replacing\`. Mulai dulu dengan \`/redfinger replace\`.`);
  }

  const newAccount = await createAccount({
    guildId: oldAccount.guildId,
    label: data.label,
    username: data.username,
    passwordEncrypted: data.passwordEncrypted,
    instanceId: data.instanceId,
    startDate: new Date(),
    dueDate: data.dueDate,
    status: timeBasedStatus(data.dueDate),
    notes: `Pengganti untuk ${oldAccount.code} (${oldAccount.label}).`,
    replacesId: oldAccount.id,
    createdById: actorId,
  });

  await prisma.redfingerAccount.update({
    where: { id: oldAccount.id },
    data: { status: 'REPLACED', replacedById: newAccount.id },
  });
  await closeOpenJobs(oldAccount.id, 'SUCCESS', `Diganti oleh ${newAccount.code}.`, 'REPLACE');

  await logRedfingerAction(client, {
    guildId: oldAccount.guildId,
    accountId: oldAccount.id,
    action: 'REPLACE_SUCCESS',
    title: '🔁 Replace selesai',
    message: `**${oldAccount.label}** (\`${oldAccount.code}\`) → digantikan **${newAccount.label}** (\`${newAccount.code}\`), jatuh tempo ${formatDue(newAccount.dueDate)}.`,
    actorId,
    color: BRAND.successColor,
  });
  await logRedfingerAction(client, {
    guildId: newAccount.guildId,
    accountId: newAccount.id,
    action: 'ADD',
    title: '➕ Akun pengganti ditambahkan',
    message: `Akun **${newAccount.label}** (\`${newAccount.code}\`) dibuat sebagai pengganti \`${oldAccount.code}\`.`,
    actorId,
  });
  return { ok: true, value: newAccount };
}

/** Nonaktifkan (berhenti dipantau) / aktifkan lagi akun. */
export async function setAccountDisabled(
  client: Client,
  account: RedfingerAccount,
  actorId: string,
  disable: boolean
): Promise<WorkflowResult<RedfingerAccount>> {
  if (disable && account.status === 'DISABLED') return fail('Akun ini sudah nonaktif.');
  if (disable && account.status === 'REPLACED') return fail('Akun ini sudah digantikan, tidak perlu dinonaktifkan.');
  if (!disable && account.status !== 'DISABLED') return fail(`Akun ini tidak sedang nonaktif (status ${statusText(account.status)}).`);

  if (disable) await closeOpenJobs(account.id, 'CANCELLED', 'Akun dinonaktifkan.');

  const updated = await prisma.redfingerAccount.update({
    where: { id: account.id },
    data: { status: disable ? 'DISABLED' : timeBasedStatus(account.dueDate) },
  });
  await logRedfingerAction(client, {
    guildId: account.guildId,
    accountId: account.id,
    action: disable ? 'DISABLE' : 'ENABLE',
    title: disable ? '⚪ Akun dinonaktifkan' : '🟢 Akun diaktifkan',
    message: `**${account.label}** (\`${account.code}\`): ${statusText(account.status)} → ${statusText(updated.status)}`,
    actorId,
  });
  return { ok: true, value: updated };
}

/**
 * Saat bot start: job browser yang statusnya masih STARTED pasti terputus (proses mati di
 * tengah jalan). Tandai gagal + beri tahu admin, supaya tidak ada akun yang "renewing" selamanya.
 */
export async function recoverInterruptedJobs(client: Client): Promise<void> {
  const jobs = await prisma.redfingerJob.findMany({ where: { mode: 'BROWSER', status: 'STARTED' }, include: { account: true } });
  for (const job of jobs) {
    await applyBrowserFailure(client, job.id, job.account, 'Bot restart saat job browser berjalan.').catch((err) =>
      console.error('[redfinger] Gagal memulihkan job terputus:', err)
    );
  }
}
