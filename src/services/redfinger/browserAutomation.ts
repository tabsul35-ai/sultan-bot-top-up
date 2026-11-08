import { loginAndSync, webAutomationAvailable } from './redfingerWeb';

/**
 * Pengecekan renew via browser untuk alur /redfinger renew mode:browser & tombol "Cek Ulang".
 * Memakai alur login web Redfinger yang sudah dikalibrasi (redfingerWeb.ts): login, baca daftar
 * device, lalu bandingkan masa aktif device ini dengan jatuh tempo di database.
 *
 * Bot TIDAK melakukan pembayaran/redeem di sini dan TIDAK melewati CAPTCHA/OTP/MFA.
 */

export type BrowserCheckResult =
  | { kind: 'success'; dueDate: Date; message: string }
  | { kind: 'needs_verification'; message: string }
  | { kind: 'failed'; message: string };

export function browserAutomationStatus(): { available: boolean; reason?: string } {
  return webAutomationAvailable();
}

// Antrian: maksimal 1 browser berjalan sekaligus supaya VPS kecil tidak kehabisan RAM.
let queue: Promise<unknown> = Promise.resolve();

export function enqueueBrowserJob<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export async function runBrowserRenewCheck(input: {
  username: string;
  password: string;
  instanceId: string | null;
  currentDueDate: Date;
}): Promise<BrowserCheckResult> {
  if (!input.instanceId) {
    return { kind: 'failed', message: 'Instance/Device ID akun ini kosong - isi dulu lewat `/redfinger edit` supaya device bisa dicari.' };
  }

  const result = await loginAndSync(input.username, input.password, { tag: 'renewcheck' });
  if (result.kind === 'needs_verification') return { kind: 'needs_verification', message: result.message };
  if (result.kind !== 'ok') return { kind: 'failed', message: result.message };

  const device = result.devices.find((d) => d.remoteId.toLowerCase() === input.instanceId!.toLowerCase());
  if (!device) return { kind: 'failed', message: `Device \`${input.instanceId}\` tidak ditemukan di akun Redfinger ini.` };

  if (device.dueDate.getTime() > input.currentDueDate.getTime() + 60_000) {
    return { kind: 'success', dueDate: device.dueDate, message: 'Masa aktif baru terbaca dari Redfinger.' };
  }
  return {
    kind: 'needs_verification',
    message:
      'Login berhasil, tetapi masa aktif di Redfinger belum bertambah. Selesaikan perpanjangan (kode/pembayaran) di Redfinger, lalu tekan **Cek Ulang via Browser** atau **Tandai Selesai**.',
  };
}
