import { Client } from 'discord.js';
import { RedfingerAccount, RedfingerLogin, RedfingerTask } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { BRAND } from '../../config/config';
import { createAccount, maskIdentifier, statusText, timeBasedStatus } from './accountService';
import { decryptSecret, encryptSecret, isEncryptionConfigured } from './crypto';
import { enqueueBrowserJob } from './browserAutomation';
import {
  getReplaceOptions,
  loginAndSync,
  ParsedDevice,
  performReplace,
  ReplaceOptionsResult,
  ReplaceResult,
  SyncResult,
  webAutomationAvailable,
} from './redfingerWeb';
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
    const ids = [device.remoteId, ...device.altIds];
    const existing = await prisma.redfingerAccount.findFirst({
      where: { guildId: login.guildId, status: { not: 'REPLACED' }, OR: ids.map((id) => ({ instanceId: { equals: id, mode: 'insensitive' as const } })) },
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

    const meta = {
      loginId: login.id,
      instanceId: device.remoteId, // perbarui id lama (padId) → padCode
      region: device.region ?? existing.region,
      androidVersion: device.androidVersion ?? existing.androidVersion,
    };
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

// ---------------------------------------------------------------------------------------------
// REPLACE otomatis (ganti region / versi Android device di Redfinger)
// ---------------------------------------------------------------------------------------------

async function loginCredentials(loginId: string | null) {
  if (!loginId) return null;
  const login = await prisma.redfingerLogin.findUnique({ where: { id: loginId } });
  if (!login) return null;
  let storageState: string | null = null;
  try {
    storageState = login.browserStateEncrypted ? decryptSecret(login.browserStateEncrypted) : null;
  } catch {
    storageState = null;
  }
  return { login, password: decryptSecret(login.passwordEncrypted), storageState };
}

async function saveStorageState(loginId: string, state?: string) {
  if (!state) return;
  await prisma.redfingerLogin.update({ where: { id: loginId }, data: { browserStateEncrypted: encryptSecret(state) } }).catch(() => {});
}

/** Ambil pilihan versi Android × server untuk replace device ini (langsung dari Redfinger). */
export async function fetchReplaceOptions(account: RedfingerAccount): Promise<ReplaceOptionsResult> {
  const creds = await loginCredentials(account.loginId);
  if (!creds) return { kind: 'failed', message: 'Device ini tidak terhubung ke akun login (Register) - replace otomatis tidak bisa dijalankan.', diagnosticFile: null };
  if (!account.instanceId) return { kind: 'failed', message: 'Device ID (padCode) device ini kosong.', diagnosticFile: null };

  const result = await enqueueBrowserJob(() =>
    getReplaceOptions(creds.login.email, creds.password, account.instanceId!, { storageState: creds.storageState, tag: `replace-options-${account.code}` })
  );
  await saveStorageState(creds.login.id, result.storageState);
  if (result.kind === 'ok') {
    // Versi Android & region saat ini terbaca dari panel device.
    const { version, region } = result.options.current;
    await prisma.redfingerAccount
      .update({ where: { id: account.id }, data: { ...(version ? { androidVersion: version } : {}), ...(region ? { region } : {}) } })
      .catch(() => {});
  }
  return result;
}

export interface ReplaceRunSummary {
  ok: boolean;
  message: string;
  account: RedfingerAccount | null;
  oldCode: string | null;
  newCode: string | null;
}

/** Jalankan replace di Redfinger lalu perbarui device di database (kode RF & label tetap). */
export async function runReplace(
  client: Client,
  account: RedfingerAccount,
  target: { version: string; server: string },
  actorId: string
): Promise<ReplaceRunSummary> {
  const creds = await loginCredentials(account.loginId);
  if (!creds || !account.instanceId) {
    return { ok: false, message: 'Device ini tidak terhubung ke akun login (Register).', account, oldCode: account.instanceId, newCode: null };
  }
  const oldCode = account.instanceId;

  // Proses replace manual lama (kalau ada) ditutup - diganti proses otomatis ini.
  await prisma.redfingerJob.updateMany({
    where: { accountId: account.id, status: { in: ['STARTED', 'NEEDS_VERIFICATION'] } },
    data: { status: 'CANCELLED', message: 'Digantikan replace otomatis.', finishedAt: new Date() },
  });
  await prisma.redfingerAccount.update({ where: { id: account.id }, data: { status: 'REPLACING' } });
  let task = await prisma.redfingerTask.create({
    data: { guildId: account.guildId, loginId: creds.login.id, accountId: account.id, type: 'REPLACE', status: 'QUEUED', actorId },
  });
  await logRedfingerAction(client, {
    guildId: account.guildId,
    accountId: account.id,
    action: 'REPLACE_START',
    title: '🔁 Replace otomatis dimulai',
    message: `**${account.label}** (\`${account.code}\` · ${oldCode}) → **${target.server} · Android ${target.version}**.`,
    actorId,
  });

  const result: ReplaceResult = await enqueueBrowserJob(async () => {
    task = await prisma.redfingerTask.update({ where: { id: task.id }, data: { status: 'RUNNING', attempts: { increment: 1 } } });
    return performReplace(creds.login.email, creds.password, oldCode, target, { storageState: creds.storageState, tag: `replace-${account.code}` });
  });
  await saveStorageState(creds.login.id, result.storageState);

  if (result.kind !== 'ok') {
    const restored = await prisma.redfingerAccount.update({ where: { id: account.id }, data: { status: timeBasedStatus(account.dueDate) } });
    task = await prisma.redfingerTask.update({
      where: { id: task.id },
      data: { status: result.kind === 'needs_verification' ? 'NEEDS_VERIFICATION' : 'FAILED', message: result.message.slice(0, 500), finishedAt: new Date() },
    });
    await logRedfingerAction(client, {
      guildId: account.guildId,
      accountId: account.id,
      action: 'REPLACE_FAILED',
      title: '❌ Replace gagal',
      message: `**${account.label}** (\`${account.code}\`): ${result.message}${result.diagnosticFile ? '\nDiagnostik tersimpan di server.' : ''}`,
      actorId,
      color: BRAND.errorColor,
    });
    return { ok: false, message: result.message, account: restored, oldCode, newCode: null };
  }

  // Cocokkan device lama → device hasil replace
  const stillThere = result.devices.find((d) => d.remoteId === oldCode);
  const fresh = result.devices.filter((d) => !result.previousCodes.includes(d.remoteId));
  const newDevice = stillThere ?? (fresh.length === 1 ? fresh[0] : null);

  let updated: RedfingerAccount;
  if (newDevice) {
    updated = await prisma.redfingerAccount.update({
      where: { id: account.id },
      data: {
        instanceId: newDevice.remoteId,
        region: newDevice.region ?? target.server,
        androidVersion: target.version,
        dueDate: newDevice.dueDate,
        status: timeBasedStatus(newDevice.dueDate),
        notes: [account.notes, `Replace ${new Date().toISOString().slice(0, 10)}: ${oldCode} → ${newDevice.remoteId} (${target.server} · Android ${target.version}).`]
          .filter(Boolean)
          .join('\n')
          .slice(-1000),
      },
    });
  } else {
    updated = await prisma.redfingerAccount.update({
      where: { id: account.id },
      data: { region: target.server, androidVersion: target.version, status: timeBasedStatus(account.dueDate) },
    });
  }
  // Device lain di akun yang sama ikut diperbarui
  await applyDevices(client, creds.login, result.devices, actorId);

  task = await prisma.redfingerTask.update({
    where: { id: task.id },
    data: { status: 'SUCCESS', message: `${oldCode} → ${newDevice?.remoteId ?? oldCode} (${target.server} · Android ${target.version})`, finishedAt: new Date() },
  });
  await logRedfingerAction(client, {
    guildId: account.guildId,
    accountId: account.id,
    action: 'REPLACE_SUCCESS',
    title: '✅ Replace berhasil',
    message: `**${updated.label}** (\`${updated.code}\`): ${oldCode} → ${updated.instanceId} · **${target.server} · Android ${target.version}**. Jatuh tempo ${formatDue(updated.dueDate)}.`,
    actorId,
    color: BRAND.successColor,
  });
  return { ok: true, message: result.message, account: updated, oldCode, newCode: updated.instanceId };
}
