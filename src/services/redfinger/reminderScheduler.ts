import type { Client } from 'discord.js';
import { RedfingerAccount } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { BRAND, redfingerConfig } from '../../config/config';
import { MONITORED_STATUSES, buildAccountEmbed, statusText, timeBasedStatus } from './accountService';
import { calendarDaysLeft } from './dates';
import { logRedfingerAction, reminderButtons, sendAdminNotification } from './notify';
import { recoverInterruptedJobs } from './workflow';

/**
 * Scheduler masa aktif Redfinger. Tiap REDFINGER_CHECK_INTERVAL_MINUTES:
 *  1. Status otomatis: ACTIVE -> EXPIRING (masuk jendela H-terbesar) -> EXPIRED (lewat jatuh tempo).
 *  2. Pengingat ke channel admin pada tahap REDFINGER_REMINDER_DAYS (default H-7, H-3, H-1)
 *     dan saat sudah habis, dengan tombol Renew / Replace / Tandai Selesai.
 *
 * Anti-duplikat: setiap tahap yang terkirim disimpan di RedfingerReminder dengan kunci unik
 * (accountId, dueDate, stage). Kalau bot mati beberapa hari lalu hidup lagi, hanya tahap paling
 * mendesak yang dikirim (tahap yang lebih awal ikut ditandai terkirim, tidak dikirim mundur).
 * Saat jatuh tempo berubah (renew), siklus pengingat otomatis mulai lagi dari awal.
 */

let started = false;
let running = false;

const EXPIRED_STAGE = 'EXPIRED';

function stageKey(days: number): string {
  return `D${days}`;
}

function stageTitle(stage: string): string {
  return stage === EXPIRED_STAGE ? 'SUDAH HABIS' : `H-${stage.slice(1)}`;
}

/** Tahap-tahap yang sudah "jatuh" untuk akun ini, urut dari paling mendesak. */
function dueStages(account: RedfingerAccount, now: Date): string[] {
  const stages: string[] = [];
  if (account.dueDate.getTime() <= now.getTime()) stages.push(EXPIRED_STAGE);
  const daysLeft = calendarDaysLeft(account.dueDate, now);
  // reminderDays urut menurun (7,3,1) -> balik supaya yang terkecil (paling mendesak) duluan
  for (const d of [...redfingerConfig.reminderDays].reverse()) {
    if (daysLeft <= d) stages.push(stageKey(d));
  }
  return stages;
}

async function updateTimeStatus(client: Client, account: RedfingerAccount, now: Date): Promise<RedfingerAccount> {
  if (account.status !== 'ACTIVE' && account.status !== 'EXPIRING') return account;

  const target = timeBasedStatus(account.dueDate, now);
  if (target === account.status) return account;

  const updated = await prisma.redfingerAccount.update({ where: { id: account.id }, data: { status: target } });
  await logRedfingerAction(client, {
    guildId: account.guildId,
    accountId: account.id,
    action: 'STATUS_AUTO',
    title: '🕒 Status otomatis',
    message: `**${account.label}** (\`${account.code}\`): ${statusText(account.status)} → ${statusText(target)}`,
  });
  return updated;
}

async function processAccount(client: Client, original: RedfingerAccount, now: Date): Promise<void> {
  const account = await updateTimeStatus(client, original, now);

  const stages = dueStages(account, now);
  if (stages.length === 0) return;

  const sent = await prisma.redfingerReminder.findMany({
    where: { accountId: account.id, dueDate: account.dueDate },
    select: { stage: true },
  });
  const sentSet = new Set(sent.map((r) => r.stage));
  const urgent = stages[0];
  if (sentSet.has(urgent)) return;

  // Saat renew/replace sedang dikerjakan, pengingat H-x ditunda (bukan dibuang) supaya tidak
  // mengganggu - tapi notifikasi "sudah habis" tetap dikirim karena penting.
  if ((account.status === 'RENEWING' || account.status === 'REPLACING') && urgent !== EXPIRED_STAGE) return;

  const newStages = stages.filter((s) => !sentSet.has(s));
  await prisma.redfingerReminder.createMany({
    data: newStages.map((stage) => ({ accountId: account.id, dueDate: account.dueDate, stage })),
    skipDuplicates: true,
  });

  const isExpired = urgent === EXPIRED_STAGE;
  const embed = buildAccountEmbed(account, { title: `⏰ Redfinger ${stageTitle(urgent)} — ${account.label}` })
    .setColor(isExpired ? BRAND.errorColor : BRAND.pendingColor)
    .setDescription(
      isExpired
        ? 'Masa aktif akun/instance ini **sudah habis**. Renew atau ganti secepatnya.'
        : `Masa aktif akan habis dalam **${stageTitle(urgent)}**. Siapkan renew atau penggantian.`
    );

  const delivered = await sendAdminNotification(client, account.guildId, {
    embeds: [embed],
    components: [reminderButtons(account.id)],
    mentionRole: true,
  });

  if (!delivered) {
    // Channel belum diatur / Discord error - lepas tanda supaya dicoba lagi di putaran berikutnya.
    await prisma.redfingerReminder.deleteMany({
      where: { accountId: account.id, dueDate: account.dueDate, stage: { in: newStages } },
    });
    return;
  }

  await logRedfingerAction(client, {
    guildId: account.guildId,
    accountId: account.id,
    action: 'REMINDER_SENT',
    title: '⏰ Pengingat terkirim',
    message: `Pengingat **${stageTitle(urgent)}** untuk **${account.label}** (\`${account.code}\`) dikirim ke channel admin.`,
  });
}

/** Satu putaran pengecekan untuk semua guild. Aman dipanggil kapan saja (tidak tumpang tindih). */
export async function runRedfingerCheck(client: Client): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const accounts = await prisma.redfingerAccount.findMany({
      where: { status: { in: MONITORED_STATUSES } },
      orderBy: { dueDate: 'asc' },
    });
    for (const account of accounts) {
      try {
        await processAccount(client, account, now);
      } catch (err) {
        console.error(`[redfinger] Gagal memproses pengingat akun ${account.code} (guild ${account.guildId}):`, err);
      }
    }
  } catch (err) {
    console.error('[redfinger] Gagal menjalankan pengecekan masa aktif:', err);
  } finally {
    running = false;
  }
}

/** Nyalakan scheduler. Panggil sekali saat bot ready. */
export function startRedfingerScheduler(client: Client): void {
  if (started) return;
  started = true;

  void (async () => {
    await recoverInterruptedJobs(client).catch((err) => console.error('[redfinger] recoverInterruptedJobs:', err));
    await runRedfingerCheck(client);
  })();

  setInterval(() => {
    void runRedfingerCheck(client);
  }, redfingerConfig.checkIntervalMinutes * 60 * 1000);

  console.log(
    `⏰ Scheduler Redfinger aktif: cek tiap ${redfingerConfig.checkIntervalMinutes} menit, pengingat H-${redfingerConfig.reminderDays.join('/H-')} + saat habis.`
  );
}
