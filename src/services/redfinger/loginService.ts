import { Client } from 'discord.js';
import { RedfingerAccount, RedfingerLogin, RedfingerTask } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { BRAND } from '../../config/config';
import { createAccount, maskIdentifier, statusText, timeBasedStatus } from './accountService';
import { decryptSecret, encryptSecret, isEncryptionConfigured } from './crypto';
import { enqueueBrowserJob } from './browserAutomation';
import { loginAndSync, ParsedDevice, SyncResult, webAutomationAvailable } from './redfingerWeb';
import { createDiscordVerifier } from './verification';
import type { InteractionEditReplyOptions } from 'discord.js';
import { logRedfingerAction } from './notify';
import { completeRenew } from './workflow';
import { formatDue } from './dates';

/**
 * Redfinger Manager: akun login (tombol Register) → tugas LOGIN_SYNC → device otomatis tercatat
 * sebagai RedfingerAccount lengkap dengan masa aktif dari Redfinger (tanpa input tanggal manual).
 */

export interface SyncSummary {
  task: RedfingerTask;
  login: RedfingerLogin;
  result: SyncResult;
  created: RedfingerAccount[];
  updated: RedfingerAccount[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Simpan/perbarui kredensial login. Return error string kalau tidak bisa. */
export async function upsertLogin(guildId: string, email: string, password: string, actorId: string): Promise<{ login: RedfingerLogin } | { error: string }> {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) return { error: 'Format email tidak valid.' };
  if (!password) return { error: 'Password wajib diisi.' };
  if (!isEncryptionConfigured()) return { error: '`REDFINGER_ENCRYPTION_KEY` belum diatur di .env - password tidak bisa disimpan dengan aman.' };
  const availability = webAutomationAvailable();
  if (!availability.available) return { error: `Otomasi browser belum aktif: ${availability.reason}` };

  const login = await prisma.redfingerLogin.upsert({
    where: { guildId_email: { guildId, email: normalized } },
    update: { passwordEncrypted: encryptSecret(password), status: 'PENDING', lastError: null },
    create: { guildId, email: normalized, passwordEncrypted: encryptSecret(password), createdById: actorId },
  });
  return { login };
}

/** Simpan hasil sinkron: buat device baru / perbarui masa aktif device yang sudah ada. */
async function applyDevices(client: Client, login: RedfingerLogin, devices: ParsedDevice[], actorId: string | null) {
  const created: RedfingerAccount[] = [];
  const updated: RedfingerAccount[] = [];

  for (const device of devices) {
    const existing = await prisma.redfingerAccount.findFirst({
      where: { guildId: login.guildId, instanceId: { equals: device.remoteId, mode: 'insensitive' }, status: { not: 'REPLACED' } },
    });

    if (!existing) {
      const account = await createAccount({
        guildId: login.guildId,
        label: device.name || `Device ${device.remoteId}`,
        username: login.email,
        instanceId: device.remoteId,
        loginId: login.id,
        region: device.region,
        androidVersion: device.androidVersion,
        startDate: new Date(),
        dueDate: device.dueDate,
        status: timeBasedStatus(device.dueDate),
        notes: `Disinkron otomatis dari login ${maskIdentifier(login.email)}.`,
        createdById: actorId,
      });
      created.push(account);
      await logRedfingerAction(client, {
        guildId: login.guildId,
        accountId: account.id,
        action: 'SYNC_ADD',
        title: '➕ Device tersinkron',
        message: `**${account.label}** (\`${account.code}\`) ditemukan di ${maskIdentifier(login.email)}. Jatuh tempo ${formatDue(account.dueDate)}.`,
        actorId,
      });
      continue;
    }

    const meta = { loginId: login.id, region: device.region ?? existing.region, androidVersion: device.androidVersion ?? existing.androidVersion };
    const dueChanged = Math.abs(existing.dueDate.getTime() - device.dueDate.getTime()) > 60_000;

    if (dueChanged && existing.status === 'RENEWING' && device.dueDate > existing.dueDate) {
      // Renew yang sedang berjalan ternyata sudah terjadi di Redfinger → selesaikan otomatis.
      await prisma.redfingerAccount.update({ where: { id: existing.id }, data: meta });
      const res = await completeRenew(client, existing, device.dueDate, actorId, 'Terdeteksi dari sinkron Redfinger.');
      if (res.ok) updated.push(res.value);
      continue;
    }

    const keepStatus = ['DISABLED', 'RENEWING', 'REPLACING', 'REPLACED'].includes(existing.status);
    const account = await prisma.redfingerAccount.update({
      where: { id: existing.id },
      data: { ...meta, dueDate: device.dueDate, ...(keepStatus ? {} : { status: timeBasedStatus(device.dueDate) }) },
    });
    if (dueChanged) {
      updated.push(account);
      await logRedfingerAction(client, {
        guildId: login.guildId,
        accountId: account.id,
        action: 'SYNC_UPDATE',
        title: '🔄 Masa aktif diperbarui',
        message: `**${account.label}** (\`${account.code}\`): ${formatDue(existing.dueDate)} → ${formatDue(account.dueDate)} (${statusText(account.status)}).`,
        actorId,
      });
    }
  }
  return { created, updated };
}

/** Buat tugas LOGIN_SYNC dan jalankan (antri, 1 browser sekaligus). Tidak melempar error. */
export async function runLoginSync(
  client: Client,
  loginId: string,
  actorId: string | null,
  opts: { collectPages?: boolean; notify?: (payload: InteractionEditReplyOptions) => Promise<unknown> } = {}
): Promise<SyncSummary | null> {
  const login0 = await prisma.redfingerLogin.findUnique({ where: { id: loginId } });
  if (!login0) return null;

  let task = await prisma.redfingerTask.create({
    data: { guildId: login0.guildId, loginId, type: 'LOGIN_SYNC', actorId, status: 'QUEUED' },
  });

  return enqueueBrowserJob(async () => {
    const login = await prisma.redfingerLogin.findUnique({ where: { id: loginId } });
    if (!login) {
      task = await prisma.redfingerTask.update({ where: { id: task.id }, data: { status: 'FAILED', message: 'Login sudah dihapus (logout).', finishedAt: new Date() } });
      return null;
    }
    task = await prisma.redfingerTask.update({ where: { id: task.id }, data: { status: 'RUNNING', attempts: { increment: 1 } } });

    let result: SyncResult;
    try {
      let storageState: string | null = null;
      try {
        storageState = login.browserStateEncrypted ? decryptSecret(login.browserStateEncrypted) : null;
      } catch {
        storageState = null; // kunci berubah / data rusak → login sebagai perangkat baru
      }
      result = await loginAndSync(login.email, decryptSecret(login.passwordEncrypted), {
        collectPages: opts.collectPages,
        tag: task.id,
        storageState,
        verifier: opts.notify ? createDiscordVerifier(task.id, opts.notify) : undefined,
      });
    } catch (err) {
      result = { kind: 'failed', message: err instanceof Error ? err.message : 'Error tidak diketahui', diagnosticFile: null };
    }

    let created: RedfingerAccount[] = [];
    let updated: RedfingerAccount[] = [];
    let message: string;

    if (result.kind === 'ok') {
      ({ created, updated } = await applyDevices(client, login, result.devices, actorId));
      message = `${result.devices.length} device tersinkron (${created.length} baru, ${updated.length} berubah).`;
    } else {
      message = result.message;
    }

    const loginStatus =
      result.kind === 'ok' || result.kind === 'needs_calibration'
        ? 'OK'
        : result.kind === 'bad_credentials'
          ? 'BAD_CREDENTIALS'
          : result.kind === 'needs_verification'
            ? 'NEEDS_VERIFICATION'
            : 'FAILED';

    const updatedLogin = await prisma.redfingerLogin.update({
      where: { id: login.id },
      data: {
        status: loginStatus,
        lastError: result.kind === 'ok' ? null : message,
        // Identitas perangkat yang sudah terverifikasi - disimpan terenkripsi.
        ...(result.storageState ? { browserStateEncrypted: encryptSecret(result.storageState) } : {}),
        ...(result.kind === 'ok' ? { lastSyncAt: new Date(), deviceCount: result.devices.length } : {}),
      },
    });
    task = await prisma.redfingerTask.update({
      where: { id: task.id },
      data: {
        status: result.kind === 'ok' ? 'SUCCESS' : result.kind === 'needs_verification' ? 'NEEDS_VERIFICATION' : 'FAILED',
        message: message.slice(0, 500),
        finishedAt: new Date(),
      },
    });

    await logRedfingerAction(client, {
      guildId: login.guildId,
      action: `LOGIN_SYNC_${task.status}`,
      title: result.kind === 'ok' ? '✅ Sinkron Redfinger berhasil' : '⚠️ Sinkron Redfinger belum berhasil',
      message: `Login ${maskIdentifier(login.email)}: ${message}${result.diagnosticFile ? '\nDiagnostik tersimpan di server.' : ''}`,
      actorId,
      color: result.kind === 'ok' ? BRAND.successColor : BRAND.pendingColor,
    });
    if (result.diagnosticFile) console.log(`[redfinger] Diagnostik task ${task.id}: ${result.diagnosticFile}`);

    return { task, login: updatedLogin, result, created, updated };
  }).catch((err) => {
    console.error('[redfinger] runLoginSync error:', err);
    return null;
  });
}

/** Logout: hapus kredensial. Device tetap tercatat (jadi data manual, tidak disinkron lagi). */
export async function logoutLogin(client: Client, login: RedfingerLogin, actorId: string) {
  await prisma.redfingerLogin.delete({ where: { id: login.id } });
  await logRedfingerAction(client, {
    guildId: login.guildId,
    action: 'LOGOUT',
    title: '🚪 Logout akun Redfinger',
    message: `Login ${maskIdentifier(login.email)} dihapus beserta password terenkripsinya. Device yang sudah tercatat tetap ada (tidak disinkron lagi).`,
    actorId,
  });
}

/** Login yang tugas terakhirnya gagal / perlu verifikasi - untuk tombol Retry Tasks. */
export async function loginsNeedingRetry(guildId: string): Promise<RedfingerLogin[]> {
  return prisma.redfingerLogin.findMany({
    where: { guildId, status: { in: ['FAILED', 'NEEDS_VERIFICATION', 'PENDING'] } },
    orderBy: { updatedAt: 'asc' },
  });
}

/** Saat bot start: tugas yang masih QUEUED/RUNNING pasti terputus - tandai gagal. */
export async function recoverInterruptedTasks(): Promise<void> {
  await prisma.redfingerTask.updateMany({
    where: { status: { in: ['QUEUED', 'RUNNING'] } },
    data: { status: 'FAILED', message: 'Bot restart saat tugas berjalan. Tekan Retry Tasks.', finishedAt: new Date() },
  });
}

/** Ringkasan untuk panel. */
export async function managerStats(guildId: string) {
  const [logins, byStatus, tasks] = await Promise.all([
    prisma.redfingerLogin.count({ where: { guildId } }),
    prisma.redfingerAccount.groupBy({ by: ['status'], where: { guildId }, _count: { _all: true } }),
    prisma.redfingerTask.groupBy({ by: ['type'], where: { guildId, status: 'SUCCESS' }, _count: { _all: true } }),
  ]);
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  const taskCount = (t: string) => tasks.find((x) => x.type === t)?._count._all ?? 0;
  return {
    logins,
    devices: byStatus.filter((b) => b.status !== 'REPLACED').reduce((n, b) => n + b._count._all, 0),
    active: count('ACTIVE'),
    expiring: count('EXPIRING'),
    expired: count('EXPIRED'),
    syncs: taskCount('LOGIN_SYNC'),
    redeems: taskCount('REDEEM'),
    renews: taskCount('RENEW'),
    replaces: taskCount('REPLACE'),
  };
}
