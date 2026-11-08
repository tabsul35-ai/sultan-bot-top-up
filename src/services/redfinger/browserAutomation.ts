import { redfingerConfig } from '../../config/config';
import { parseDateInput } from './dates';

/**
 * OTOMASI BROWSER REDFINGER (OPSIONAL) - Playwright.
 *
 * Aktif hanya jika:
 *   1. REDFINGER_BROWSER_ENABLED=true
 *   2. REDFINGER_LOGIN_URL dan REDFINGER_DEVICES_URL diisi
 *   3. paket `playwright` terpasang:  npm i playwright && npx playwright install --with-deps chromium
 * Kalau salah satu tidak terpenuhi, bot otomatis memakai alur renew manual.
 *
 * Yang DILAKUKAN job ini:
 *   - login ke Redfinger dengan email/username + password akun yang dipilih,
 *   - membuka halaman daftar device, mencari instance/device ID akun itu,
 *   - membaca tanggal masa aktif yang tampil. Kalau lebih baru dari jatuh tempo di database
 *     (artinya perpanjangan sudah terjadi), renew dianggap BERHASIL dan tanggal diperbarui.
 *
 * Yang SENGAJA TIDAK dilakukan:
 *   - TIDAK melakukan pembayaran / memilih paket - perpanjangan berbayar diselesaikan manusia.
 *   - TIDAK mencoba melewati CAPTCHA, OTP, MFA, slider, atau pemeriksaan keamanan apa pun.
 *     Begitu salah satunya terdeteksi, job berhenti dengan status NEEDS_VERIFICATION dan admin
 *     diberi tahu untuk menyelesaikannya sendiri, lalu menekan "Cek Ulang" / "Tandai Selesai".
 *   - TIDAK mengambil screenshot (bisa berisi data akun) dan tidak menyimpan cookie sesi.
 *
 * Selector di bawah adalah tebakan GENERIK - tampilan web Redfinger bisa berbeda / berubah.
 * Sesuaikan SELECTORS dengan halaman asli sebelum dipakai. Kalau elemen tidak ditemukan, job
 * GAGAL dengan pesan jelas (tidak pernah menebak tanggal).
 */

const SELECTORS = {
  usernameInput: 'input[type="email"], input[name*="email" i], input[name*="user" i], input[name*="account" i], input[name*="phone" i], input[type="text"]',
  passwordInput: 'input[type="password"]',
  submitButton:
    'button[type="submit"], button:has-text("Login"), button:has-text("Log in"), button:has-text("Sign in"), button:has-text("Masuk"), input[type="submit"]',
  // Penanda halaman verifikasi keamanan - kalau ada, berhenti & minta tindakan manusia.
  verification: [
    'iframe[src*="captcha" i]',
    'iframe[title*="captcha" i]',
    'iframe[src*="recaptcha" i]',
    'iframe[src*="hcaptcha" i]',
    '[class*="captcha" i]',
    '[id*="captcha" i]',
    '[class*="geetest" i]',
    'input[autocomplete="one-time-code"]',
    'input[name*="otp" i]',
    'input[name*="verif" i]',
  ],
};

const VERIFICATION_TEXT = /verification code|kode verifikasi|security (check|verification)|verify (that )?you|one[- ]time (password|code)|\bOTP\b|slide to (verify|complete)|captcha/i;
const LOGIN_ERROR_TEXT = /incorrect|wrong password|invalid (account|password|email)|salah|tidak valid|failed to log ?in/i;
const DATE_IN_TEXT = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/g;

export type BrowserCheckResult =
  | { kind: 'success'; dueDate: Date; message: string }
  | { kind: 'needs_verification'; message: string }
  | { kind: 'failed'; message: string };

let playwrightModule: any | null | undefined;

function loadPlaywright(): any | null {
  if (playwrightModule !== undefined) return playwrightModule;
  try {
    // require dinamis: playwright bukan dependency wajib proyek ini.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    playwrightModule = require('playwright');
  } catch {
    playwrightModule = null;
  }
  return playwrightModule;
}

/** Apakah mode browser bisa dipakai sekarang? `reason` diisi kalau tidak. */
export function browserAutomationStatus(): { available: boolean; reason?: string } {
  const cfg = redfingerConfig.browser;
  if (!cfg.enabled) return { available: false, reason: 'REDFINGER_BROWSER_ENABLED belum diset `true`.' };
  if (!cfg.loginUrl || !cfg.devicesUrl) return { available: false, reason: 'REDFINGER_LOGIN_URL / REDFINGER_DEVICES_URL belum diisi.' };
  if (!loadPlaywright()) {
    return { available: false, reason: 'Paket `playwright` belum terpasang (`npm i playwright && npx playwright install --with-deps chromium`).' };
  }
  return { available: true };
}

// Antrian sederhana: maksimal 1 browser berjalan sekaligus supaya VPS kecil tidak kehabisan RAM.
let queue: Promise<unknown> = Promise.resolve();

export function enqueueBrowserJob<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function hasVerificationChallenge(page: any): Promise<boolean> {
  for (const selector of SELECTORS.verification) {
    const visible = await page.locator(selector).first().isVisible().catch(() => false);
    if (visible) return true;
  }
  const bodyText: string = await page.locator('body').innerText().catch(() => '');
  return VERIFICATION_TEXT.test(bodyText);
}

async function firstVisible(page: any, selector: string): Promise<any | null> {
  const loc = page.locator(selector);
  const count: number = await loc.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const item = loc.nth(i);
    if (await item.isVisible().catch(() => false)) return item;
  }
  return null;
}

/** Ambil teks "baris" device yang memuat instanceId (naik ke parent sampai ketemu tanggal). */
async function deviceRowText(page: any, instanceId: string): Promise<string | null> {
  return page.evaluate((id: string) => {
    const doc = (globalThis as any).document;
    const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
    const datePattern = /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/;
    let node = walker.nextNode();
    while (node) {
      if (node.textContent && node.textContent.includes(id)) {
        let el = node.parentElement;
        for (let depth = 0; el && depth < 8; depth++) {
          const text: string = el.innerText || el.textContent || '';
          if (datePattern.test(text)) return text;
          el = el.parentElement;
        }
        return null;
      }
      node = walker.nextNode();
    }
    return null;
  }, instanceId);
}

function latestDateIn(text: string): Date | null {
  let latest: Date | null = null;
  for (const m of text.matchAll(DATE_IN_TEXT)) {
    const iso = `${m[1]}-${m[2]}-${m[3]}${m[4] ? ` ${m[4]}:${m[5]}${m[6] ? `:${m[6]}` : ''}` : ''}`;
    const date = parseDateInput(iso);
    if (date && (!latest || date > latest)) latest = date;
  }
  return latest;
}

/**
 * Jalankan pengecekan renew via browser untuk satu akun. Tidak pernah melempar error -
 * semua hasil dikembalikan sebagai BrowserCheckResult. Pesan hasil aman untuk Discord
 * (tidak memuat password).
 */
export async function runBrowserRenewCheck(input: {
  username: string;
  password: string;
  instanceId: string | null;
  currentDueDate: Date;
}): Promise<BrowserCheckResult> {
  const status = browserAutomationStatus();
  if (!status.available) return { kind: 'failed', message: `Otomasi browser tidak tersedia: ${status.reason}` };
  if (!input.instanceId) {
    return { kind: 'failed', message: 'Instance/Device ID akun ini kosong - isi dulu lewat `/redfinger edit` supaya device bisa dicari.' };
  }

  const cfg = redfingerConfig.browser;
  const playwright = loadPlaywright();
  let browser: any = null;
  let finished = false;

  const work = async (): Promise<BrowserCheckResult> => {
    browser = await playwright.chromium.launch({ headless: cfg.headless });
    if (finished) {
      // timeout sudah lewat saat browser baru selesai diluncurkan - jangan biarkan proses menggantung
      await browser.close().catch(() => {});
      return { kind: 'failed', message: 'Dibatalkan (timeout).' };
    }
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);

    // 1. Halaman login
    await page.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    if (await hasVerificationChallenge(page)) {
      return { kind: 'needs_verification', message: 'Halaman login Redfinger meminta verifikasi keamanan (CAPTCHA/OTP). Selesaikan login & renew secara manual.' };
    }

    const userField = await firstVisible(page, SELECTORS.usernameInput);
    const passField = await firstVisible(page, SELECTORS.passwordInput);
    if (!userField || !passField) {
      return { kind: 'failed', message: 'Form login tidak ditemukan di REDFINGER_LOGIN_URL (selector perlu disesuaikan di browserAutomation.ts).' };
    }
    await userField.fill(input.username);
    await passField.fill(input.password);

    const submit = await firstVisible(page, SELECTORS.submitButton);
    if (submit) await submit.click();
    else await passField.press('Enter');

    // 2. Tunggu hasil login: berhasil / verifikasi / error
    const loginDeadline = Date.now() + 20_000;
    let loggedIn = false;
    while (Date.now() < loginDeadline) {
      await page.waitForTimeout(1000);
      if (await hasVerificationChallenge(page)) {
        return { kind: 'needs_verification', message: 'Redfinger meminta verifikasi (CAPTCHA/OTP/MFA) setelah login. Bot berhenti - selesaikan secara manual.' };
      }
      const stillOnLogin = await page.locator(SELECTORS.passwordInput).first().isVisible().catch(() => false);
      if (!stillOnLogin) {
        loggedIn = true;
        break;
      }
      const bodyText: string = await page.locator('body').innerText().catch(() => '');
      if (LOGIN_ERROR_TEXT.test(bodyText)) {
        return { kind: 'failed', message: 'Login Redfinger ditolak (email/username atau password salah?). Perbarui lewat `/redfinger edit`.' };
      }
    }
    if (!loggedIn) return { kind: 'failed', message: 'Login Redfinger tidak selesai dalam 20 detik.' };

    // 3. Halaman daftar device
    await page.goto(cfg.devicesUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    if (await hasVerificationChallenge(page)) {
      return { kind: 'needs_verification', message: 'Halaman device Redfinger meminta verifikasi keamanan. Selesaikan secara manual.' };
    }

    const rowText = await deviceRowText(page, input.instanceId!);
    if (!rowText) {
      return { kind: 'failed', message: `Device \`${input.instanceId}\` atau tanggal masa aktifnya tidak ditemukan di halaman device.` };
    }
    const shownDue = latestDateIn(rowText);
    if (!shownDue) return { kind: 'failed', message: 'Tanggal masa aktif device tidak bisa dibaca dari halaman Redfinger.' };

    // 4. Bandingkan dengan jatuh tempo di database
    if (shownDue.getTime() > input.currentDueDate.getTime() + 60_000) {
      return { kind: 'success', dueDate: shownDue, message: 'Masa aktif baru terbaca dari halaman device Redfinger.' };
    }
    return {
      kind: 'needs_verification',
      message:
        'Login berhasil, tetapi masa aktif di Redfinger belum bertambah. Perpanjangan/pembayaran harus diselesaikan manual di Redfinger, lalu tekan **Cek Ulang via Browser** atau **Tandai Selesai**.',
    };
  };

  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<BrowserCheckResult>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'failed', message: `Job browser melebihi batas waktu ${Math.round(cfg.timeoutMs / 1000)} detik.` }), cfg.timeoutMs);
    });
    return await Promise.race([work(), timeout]);
  } catch (err) {
    const message = err instanceof Error ? err.message.split('\n')[0] : 'Error tidak diketahui';
    return { kind: 'failed', message: `Error otomasi browser: ${message}` };
  } finally {
    finished = true;
    if (timer) clearTimeout(timer);
    await (browser as any)?.close().catch(() => {});
  }
}
