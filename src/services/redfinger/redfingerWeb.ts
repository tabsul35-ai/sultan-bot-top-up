import fs from 'fs';
import path from 'path';
import { redfingerConfig } from '../../config/config';
import { parseDateInput } from './dates';

/**
 * Otomasi web Redfinger (https://www.cloudemulator.net/app/) dengan Playwright.
 *
 * Hasil kalibrasi (Nov 2026):
 *  - Halaman login: /app/sign-in?channelCode=web → dialog "Agree" → tombol `.email-login` →
 *    input placeholder "Email" + input password → tombol "SIGN IN".
 *  - Web app memanggil API JSON di twplay.redfinger.com dengan format
 *    { resultCode, resultMsg, resultInfo }. resultCode 0 = sukses; contoh gagal:
 *    2115 "User not exist, please check your account".
 *  - Daftar cloud phone: /app/phone?channelCode=web.
 *
 * Aturan keamanan (TIDAK BOLEH dilanggar):
 *  - TIDAK mencoba melewati CAPTCHA, OTP, MFA, slider, atau risk-control apa pun, dan tidak
 *    menyamarkan browser. Begitu terdeteksi → NEEDS_VERIFICATION, admin diberi tahu.
 *  - Cookie/token sesi tidak disimpan; tiap tugas membuka browser baru lalu menutupnya.
 *  - Password hanya dipakai untuk mengisi form login, tidak pernah ditulis ke log/diagnostik.
 */

const BASE = 'https://www.cloudemulator.net/app';
const SIGN_IN_URL = `${BASE}/sign-in?channelCode=web`;
const PHONE_URL = `${BASE}/phone?channelCode=web`;

const VERIFICATION_SELECTORS = [
  'iframe[src*="captcha" i]',
  'iframe[src*="recaptcha" i]',
  'iframe[src*="hcaptcha" i]',
  'iframe[src*="geetest" i]',
  '[class*="captcha" i]',
  '[class*="geetest" i]',
  '[class*="slider-verify" i]',
  'input[autocomplete="one-time-code"]',
];
const VERIFICATION_MSG = /verif|captcha|robot|security|risk|otp|code sent|slide/i;
const BAD_CREDENTIAL_MSG = /not exist|password|incorrect|wrong|invalid account|check your account/i;
const SECRET_KEY = /token|session|cookie|sign|secret|pass|auth|rsa|key$|imei|mac|ticket/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;

export interface ParsedDevice {
  remoteId: string;
  name: string | null;
  dueDate: Date;
  region: string | null;
  androidVersion: string | null;
}

export type SyncResult =
  | { kind: 'ok'; devices: ParsedDevice[]; diagnosticFile: string | null }
  | { kind: 'bad_credentials' | 'needs_verification' | 'failed' | 'needs_calibration'; message: string; diagnosticFile: string | null };

interface ApiEntry {
  path: string;
  json: any;
}

let playwrightModule: any | null | undefined;
function loadPlaywright(): any | null {
  if (playwrightModule !== undefined) return playwrightModule;
  try {
    playwrightModule = require('playwright');
  } catch {
    playwrightModule = null;
  }
  return playwrightModule;
}

export function webAutomationAvailable(): { available: boolean; reason?: string } {
  if (!redfingerConfig.browser.enabled) return { available: false, reason: 'REDFINGER_BROWSER_ENABLED belum diset `true` di .env.' };
  if (!loadPlaywright()) return { available: false, reason: 'Paket `playwright` belum terpasang.' };
  return { available: true };
}

// ---------------------------------------------------------------------------------------------
// Diagnostik (disimpan HANYA di server, folder data/redfinger-diag) - dipakai untuk kalibrasi.
// ---------------------------------------------------------------------------------------------

function sanitize(value: any, depth = 0): any {
  if (depth > 6) return '…';
  if (Array.isArray(value)) return value.slice(0, 3).map((v) => sanitize(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value).slice(0, 60)) {
      out[k] = SECRET_KEY.test(k) ? '<redacted>' : sanitize(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return value.replace(EMAIL, '<email>').slice(0, 120);
  return value;
}

function diagDir(): string {
  const dir = path.resolve(process.cwd(), 'data', 'redfinger-diag');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function pageOutline(page: any) {
  const elements = await page
    .$$eval('input,button,a,select,textarea,[role=button],[class*=item],[class*=card],[class*=device],[class*=phone]', (els: any[]) =>
      els
        .filter((e) => e.offsetParent !== null)
        .slice(0, 150)
        .map((e) => ({
          tag: e.tagName,
          type: e.type || '',
          cls: String(e.className).slice(0, 60),
          ph: e.placeholder || '',
          text: (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60),
        }))
    )
    .catch(() => []);
  const text: string = await page.locator('body').innerText().catch(() => '');
  return {
    url: String(page.url()).split('?')[0],
    text: text.replace(/\n+/g, ' | ').replace(EMAIL, '<email>').slice(0, 3000),
    elements: elements.map((e: any) => ({ ...e, text: e.text.replace(EMAIL, '<email>') })),
  };
}

async function writeDiagnostic(tag: string, api: ApiEntry[], pages: any[], extra: Record<string, unknown>): Promise<string | null> {
  try {
    const file = path.join(diagDir(), `${new Date().toISOString().replace(/[:.]/g, '-')}-${tag}.json`);
    const payload = {
      createdAt: new Date().toISOString(),
      ...extra,
      api: api.map((a) => ({ path: a.path, json: sanitize(a.json) })),
      pages,
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    return file;
  } catch (err) {
    console.error('[redfinger web] Gagal menulis diagnostik:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Parser device dari respons API (tanpa menebak field: nama field dicocokkan pola umum)
// ---------------------------------------------------------------------------------------------

const ID_KEYS = /^(padCode|padId|padNo|deviceCode|deviceId|deviceNo|instanceId|instanceCode|phoneId|phoneCode|cloudPhoneId|userPadId)$/i;
const NAME_KEYS = /^(padName|deviceName|phoneName|alias|aliasName|name|remark|nickName)$/i;
const EXPIRE_KEYS = /(expire|expiration|endTime|end_time|deadline|validEnd|dueTime|overTime|maturity)/i;
const REGION_KEYS = /^(idc\w*|region\w*|area\w*|zone\w*|room\w*|machineRoom\w*)$/i;
const ANDROID_KEYS = /(android|osVersion|romVersion|systemVersion|padGrade|grade)/i;

function toDate(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e12) return new Date(value); // milidetik
    if (value > 1e9) return new Date(value * 1000); // detik
    return null;
  }
  if (typeof value === 'string' && value.trim()) {
    const t = value.trim();
    if (/^\d{10,13}$/.test(t)) return toDate(Number(t));
    const local = parseDateInput(t.replace(/\//g, '-').replace(/\.\d+$/, ''));
    if (local) return local;
    const parsed = Date.parse(t);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }
  return null;
}

function pick(obj: Record<string, unknown>, pattern: RegExp): unknown {
  const key = Object.keys(obj).find((k) => pattern.test(k) && obj[k] !== null && obj[k] !== '');
  return key ? obj[key] : undefined;
}

function scalarString(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'string' || typeof v === 'number') return String(v).slice(0, 100);
  return null;
}

/** Cari array objek "mirip device" di semua respons API, lalu ubah jadi ParsedDevice. */
export function extractDevices(api: ApiEntry[]): ParsedDevice[] {
  const found = new Map<string, ParsedDevice>();

  const visit = (node: unknown, depth: number) => {
    if (depth > 6 || !node) return;
    if (Array.isArray(node)) {
      for (const item of node) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const obj = item as Record<string, unknown>;
          const id = scalarString(pick(obj, ID_KEYS));
          const due = toDate(pick(obj, EXPIRE_KEYS));
          if (id && due) {
            found.set(id, {
              remoteId: id,
              name: scalarString(pick(obj, NAME_KEYS)),
              dueDate: due,
              region: scalarString(pick(obj, REGION_KEYS)),
              androidVersion: scalarString(pick(obj, ANDROID_KEYS)),
            });
            continue;
          }
        }
        visit(item, depth + 1);
      }
      return;
    }
    if (typeof node === 'object') {
      for (const v of Object.values(node as Record<string, unknown>)) visit(v, depth + 1);
    }
  };

  for (const entry of api) visit(entry.json, 0);
  return [...found.values()];
}

// ---------------------------------------------------------------------------------------------
// Sesi browser
// ---------------------------------------------------------------------------------------------

async function hasVerification(page: any): Promise<boolean> {
  for (const sel of VERIFICATION_SELECTORS) {
    if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
  }
  return false;
}

/**
 * Login + baca daftar device. Tidak pernah melempar error. `collectPages` = simpan juga
 * struktur halaman Redeem Code & Buy/Renew (read-only, tidak menekan apa pun) untuk kalibrasi.
 */
export async function loginAndSync(email: string, password: string, opts: { collectPages?: boolean; tag?: string } = {}): Promise<SyncResult> {
  const availability = webAutomationAvailable();
  if (!availability.available) return { kind: 'failed', message: availability.reason!, diagnosticFile: null };

  const pw = loadPlaywright();
  const api: ApiEntry[] = [];
  const pages: any[] = [];
  const loginErrors: { code: number; msg: string }[] = [];
  let browser: any = null;
  let finished = false;
  const tag = opts.tag ?? 'sync';

  const work = async (): Promise<SyncResult> => {
    browser = await pw.chromium.launch({ headless: redfingerConfig.browser.headless });
    if (finished) return { kind: 'failed', message: 'Dibatalkan (timeout).', diagnosticFile: null };
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);

    page.on('response', async (res: any) => {
      const url: string = res.url();
      if (!/redfinger\.com/.test(url) || /collect|\.(js|css|png|jpe?g|svg|woff2?)(\?|$)/.test(url)) return;
      try {
        const json = await res.json();
        const p = url.split('?')[0].replace(/^https?:\/\/[^/]+/, '');
        api.push({ path: p, json });
        if (/osfingerlogin|login/i.test(p) && json && typeof json.resultCode === 'number' && json.resultCode !== 0) {
          loginErrors.push({ code: json.resultCode, msg: String(json.resultMsg ?? json.resultInfo ?? '') });
        }
      } catch {
        // bukan JSON - abaikan
      }
    });

    // 1. Login dengan email
    await page.goto(SIGN_IN_URL, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
    await page.locator('button.ok').click({ timeout: 4000 }).catch(() => {}); // dialog persetujuan (kalau ada)
    const emailButton = page.locator('button.email-login');
    if (!(await emailButton.isVisible().catch(() => false))) {
      pages.push(await pageOutline(page));
      return { kind: 'failed', message: 'Tombol login email tidak ditemukan (tampilan Redfinger berubah?).', diagnosticFile: await writeDiagnostic(`${tag}-nologin`, api, pages, {}) };
    }
    await emailButton.click();
    await page.locator('input[placeholder="Email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('button', { name: 'SIGN IN' }).last().click();

    // 2. Tunggu hasil login
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1000);
      if (await hasVerification(page)) {
        pages.push(await pageOutline(page));
        return {
          kind: 'needs_verification',
          message: 'Redfinger meminta verifikasi keamanan (CAPTCHA/OTP). Bot berhenti dan tidak mencoba melewatinya.',
          diagnosticFile: await writeDiagnostic(`${tag}-verify`, api, pages, {}),
        };
      }
      const err = loginErrors[loginErrors.length - 1];
      if (err) {
        const kind = VERIFICATION_MSG.test(err.msg) ? 'needs_verification' : BAD_CREDENTIAL_MSG.test(err.msg) ? 'bad_credentials' : 'failed';
        return { kind, message: `Redfinger: ${err.msg || `kode ${err.code}`}`, diagnosticFile: null };
      }
      if (!/sign-in/.test(page.url())) break;
    }
    if (/sign-in/.test(page.url())) {
      pages.push(await pageOutline(page));
      return { kind: 'failed', message: 'Login tidak selesai dalam 25 detik.', diagnosticFile: await writeDiagnostic(`${tag}-timeout`, api, pages, {}) };
    }

    // 3. Daftar cloud phone
    await page.goto(PHONE_URL, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(4000);
    if (await hasVerification(page)) {
      pages.push(await pageOutline(page));
      return {
        kind: 'needs_verification',
        message: 'Halaman cloud phone meminta verifikasi keamanan. Bot berhenti.',
        diagnosticFile: await writeDiagnostic(`${tag}-verify`, api, pages, {}),
      };
    }
    pages.push(await pageOutline(page));
    const devices = extractDevices(api);

    // 4. (Opsional) catat struktur halaman Redeem Code & Buy/Renew - read-only
    if (opts.collectPages) {
      for (const label of ['Redeem Code', 'Buy / Renew']) {
        const menu = page.getByText(label, { exact: true }).first();
        if (await menu.isVisible().catch(() => false)) {
          await menu.click().catch(() => {});
          await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
          await page.waitForTimeout(2500);
          pages.push({ menu: label, ...(await pageOutline(page)) });
        }
      }
    }

    const diagnosticFile =
      opts.collectPages || devices.length === 0 ? await writeDiagnostic(tag, api, pages, { devicesParsed: devices.length }) : null;

    if (devices.length === 0) {
      return {
        kind: 'needs_calibration',
        message: 'Login berhasil, tetapi daftar device belum bisa dibaca otomatis (atau akun belum punya device). Struktur halaman sudah disimpan di server untuk kalibrasi.',
        diagnosticFile,
      };
    }
    return { kind: 'ok', devices, diagnosticFile };
  };

  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<SyncResult>((resolve) => {
      timer = setTimeout(
        () => resolve({ kind: 'failed', message: `Melebihi batas waktu ${Math.round(redfingerConfig.browser.timeoutMs / 1000)} detik.`, diagnosticFile: null }),
        redfingerConfig.browser.timeoutMs
      );
    });
    return await Promise.race([work(), timeout]);
  } catch (err) {
    const message = err instanceof Error ? err.message.split('\n')[0] : 'Error tidak diketahui';
    const safe = (password ? message.split(password).join('***') : message).replace(EMAIL, '<email>');
    return { kind: 'failed', message: `Error browser: ${safe}`, diagnosticFile: null };
  } finally {
    finished = true;
    if (timer) clearTimeout(timer);
    await browser?.close().catch(() => {});
  }
}
