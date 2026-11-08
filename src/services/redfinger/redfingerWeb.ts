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
const VERIFICATION_MSG = /verif|captcha|robot|security|risk|otp|code sent|slide|new device/i;
const BAD_CREDENTIAL_MSG = /not exist|password|incorrect|wrong|invalid account|check your account/i;
const SECRET_KEY = /token|session|cookie|sign|secret|pass|auth|rsa|key$|imei|mac|ticket/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;

export interface ParsedDevice {
  remoteId: string; // padCode (VM033…)
  altIds: string[]; // id lain (padId numerik) - untuk mencocokkan data lama
  name: string | null;
  dueDate: Date;
  region: string | null;
  androidVersion: string | null;
}

export type SyncResult = (
  | { kind: 'ok'; devices: ParsedDevice[]; diagnosticFile: string | null }
  | { kind: 'bad_credentials' | 'needs_verification' | 'failed' | 'needs_calibration'; message: string; diagnosticFile: string | null }
) & {
  /** Identitas perangkat terbaru (JSON storageState Playwright) - diisi kalau login berhasil. Simpan terenkripsi. */
  storageState?: string;
};

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

// Urutan prioritas nama field (hasil kalibrasi getPadList: padCode "VM033…", padId numerik,
// padName, roomName "HongKong", idcCode "HK_IDC_01", expireTime ms). padGrade = kelas (VIP), BUKAN Android.
const ID_KEYS = ['padCode', 'deviceCode', 'instanceCode', 'phoneCode', 'deviceId', 'instanceId', 'phoneId', 'cloudPhoneId', 'padNo', 'deviceNo', 'padId', 'userPadId'];
const ALT_ID_KEYS = ['padId', 'userPadId', 'deviceId', 'instanceId'];
const NAME_KEYS = ['padName', 'deviceName', 'phoneName', 'aliasName', 'alias', 'name', 'remark', 'nickName'];
const EXPIRE_KEYS = /(expire|expiration|endTime|end_time|deadline|validEnd|dueTime|overTime|maturity)/i;
const REGION_KEYS = ['roomName', 'regionName', 'idcName', 'region', 'area', 'zone', 'idcCode'];
const ANDROID_KEYS = ['androidVersion', 'sysVersion', 'systemVersion', 'osVersion', 'romVersion'];

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

function pickFirst(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const v = obj[key];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function pickPattern(obj: Record<string, unknown>, pattern: RegExp): unknown {
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
          const id = scalarString(pickFirst(obj, ID_KEYS));
          const due = toDate(pickPattern(obj, EXPIRE_KEYS));
          if (id && due) {
            const altIds = ALT_ID_KEYS.map((k) => scalarString(obj[k])).filter((x): x is string => Boolean(x) && x !== id);
            found.set(id, {
              remoteId: id,
              altIds,
              name: scalarString(pickFirst(obj, NAME_KEYS)),
              dueDate: due,
              region: scalarString(pickFirst(obj, REGION_KEYS)),
              androidVersion: scalarString(pickFirst(obj, ANDROID_KEYS)),
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
 * Penghubung ke manusia saat Redfinger meminta verifikasi perangkat baru (kode via email).
 * Bot TIDAK pernah membuat/menebak kode - kode diketik admin dari email miliknya sendiri.
 */
export interface Verifier {
  /** Minta persetujuan admin untuk mengirim kode verifikasi ke email akun. false = batal/timeout. */
  confirmSend(info: { emailMasked: string }): Promise<boolean>;
  /** Minta kode dari admin. null = batal/timeout. */
  askCode(info: { attempt: number; error?: string }): Promise<string | null>;
}

export interface SessionOptions {
  tag?: string;
  /** Identitas perangkat tersimpan (JSON storageState Playwright). */
  storageState?: string | null;
  /** Penghubung ke admin untuk verifikasi perangkat baru; tanpa ini → needs_verification. */
  verifier?: Verifier;
}

type Failure = { kind: 'bad_credentials' | 'needs_verification' | 'failed' | 'needs_calibration'; message: string; diagnosticFile: string | null };

interface SessionContext {
  page: any;
  api: ApiEntry[];
  pages: any[];
  tag: string;
  diag: (suffix: string, extra?: Record<string, unknown>) => Promise<string | null>;
}

const NEW_DEVICE_CODE = 3401;
const MAX_CODE_ATTEMPTS = 3;

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  return `${user.slice(0, 2)}•••@${domain ?? ''}`;
}

/** Kolom kode verifikasi yang terlihat (bukan kolom email/password login). */
async function findCodeInputs(page: any): Promise<any[]> {
  const loc = page.locator('input');
  const count: number = await loc.count().catch(() => 0);
  const result: any[] = [];
  for (let i = 0; i < count; i++) {
    const item = loc.nth(i);
    if (!(await item.isVisible().catch(() => false))) continue;
    const ph = String((await item.getAttribute('placeholder').catch(() => '')) ?? '');
    const type = String((await item.getAttribute('type').catch(() => '')) ?? '');
    if (/^email$/i.test(ph) || type === 'password') continue;
    result.push(item);
  }
  return result;
}

/**
 * Buka browser, login (dengan identitas perangkat tersimpan + verifikasi perangkat baru bila
 * perlu), lalu jalankan `fn`. Tidak pernah melempar error. Hasil selalu membawa storageState
 * terbaru kalau login berhasil (simpan terenkripsi).
 */
async function runWithSession<R extends { kind: string }>(
  email: string,
  password: string,
  opts: SessionOptions,
  fn: (ctx: SessionContext) => Promise<R | Failure>,
  extraTimeoutMs = 0
): Promise<(R | Failure) & { storageState?: string }> {
  const availability = webAutomationAvailable();
  if (!availability.available) return { kind: 'failed', message: availability.reason!, diagnosticFile: null };

  const pw = loadPlaywright();
  const api: ApiEntry[] = [];
  const pages: any[] = [];
  const loginErrors: { code: number; msg: string }[] = [];
  let browser: any = null;
  let finished = false;
  const tag = opts.tag ?? 'session';

  const work = async (): Promise<(R | Failure) & { storageState?: string }> => {
    browser = await pw.chromium.launch({ headless: redfingerConfig.browser.headless });
    if (finished) return { kind: 'failed', message: 'Dibatalkan (timeout).', diagnosticFile: null };

    let storageState: any = undefined;
    if (opts.storageState) {
      try {
        storageState = JSON.parse(opts.storageState);
      } catch {
        storageState = undefined;
      }
    }
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US', storageState });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const diag = (suffix: string, extra: Record<string, unknown> = {}) => writeDiagnostic(`${tag}-${suffix}`, api, pages, extra);

    page.on('response', async (res: any) => {
      const url: string = res.url();
      if (!/redfinger\.com/.test(url) || /collect|\.(js|css|png|jpe?g|svg|woff2?)(\?|$)/.test(url)) return;
      try {
        const json = await res.json();
        const p = url.split('?')[0].replace(/^https?:\/\/[^/]+/, '');
        api.push({ path: p, json });
        if (/osfingerlogin\/user|login\.html/i.test(p) && json && typeof json.resultCode === 'number' && json.resultCode !== 0) {
          loginErrors.push({ code: json.resultCode, msg: String(json.resultMsg ?? json.resultInfo ?? '') });
        }
      } catch {
        // bukan JSON - abaikan
      }
    });

    /** Tunggu sampai keluar dari halaman sign-in, ada error baru, atau verifikasi muncul. */
    const waitLoginOutcome = async (fromErrorIndex: number, ms: number): Promise<'ok' | 'new_device' | 'challenge' | { error: { code: number; msg: string } } | 'timeout'> => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        await page.waitForTimeout(1000);
        if (!/sign-in/.test(page.url())) return 'ok';
        const err = loginErrors.slice(fromErrorIndex).pop();
        if (err) return err.code === NEW_DEVICE_CODE || /new device/i.test(err.msg) ? 'new_device' : { error: err };
        if (await page.locator('.new-device-login').first().isVisible().catch(() => false)) return 'new_device';
        if (await hasVerification(page)) return 'challenge';
      }
      return 'timeout';
    };

    const login = async (): Promise<Failure | null> => {
      await page.goto(SIGN_IN_URL, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
      await page.locator('button.ok').click({ timeout: 4000 }).catch(() => {}); // dialog persetujuan (kalau ada)

      const emailButton = page.locator('button.email-login');
      // Dengan identitas perangkat tersimpan, sesi bisa langsung masuk tanpa form login.
      if (!/sign-in/.test(page.url()) || !(await emailButton.isVisible().catch(() => false))) return null;

      await emailButton.click();
      await page.locator('input[placeholder="Email"]').fill(email);
      await page.locator('input[type="password"]').fill(password);
      let errIndex = loginErrors.length;
      await page.getByRole('button', { name: 'SIGN IN' }).last().click();
      let outcome = await waitLoginOutcome(errIndex, 25_000);

      if (outcome === 'new_device') {
        if (!opts.verifier) {
          return {
            kind: 'needs_verification',
            message: 'Redfinger meminta verifikasi perangkat baru (kode ke email akun). Tekan **Retry Tasks** di panel lalu ikuti tombol Kirim Kode.',
            diagnosticFile: null,
          };
        }
        const approved = await opts.verifier.confirmSend({ emailMasked: maskEmail(email) });
        if (!approved) return { kind: 'needs_verification', message: 'Verifikasi perangkat baru dibatalkan / tidak dijawab admin.', diagnosticFile: null };

        errIndex = loginErrors.length;
        const verifyButton = page.locator('.new-device-login button.submit');
        if (!(await verifyButton.isVisible().catch(() => false))) {
          pages.push(await pageOutline(page));
          return { kind: 'failed', message: 'Tombol VERIFY di dialog Security Check tidak ditemukan.', diagnosticFile: await diag('noverify') };
        }
        await verifyButton.click();
        await page.waitForTimeout(5000);
        pages.push({ step: 'after-verify-click', ...(await pageOutline(page)) });
        const verifyDiag = await diag('verify-screen');

        const sendError = loginErrors.slice(errIndex).pop();
        if (sendError) {
          return { kind: 'needs_verification', message: `Redfinger menolak mengirim kode: ${sendError.msg || sendError.code}`, diagnosticFile: verifyDiag };
        }

        let lastError: string | undefined;
        let verified = false;
        for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS && !verified; attempt++) {
          const inputs = await findCodeInputs(page);
          if (inputs.length === 0) {
            return { kind: 'failed', message: 'Kolom kode verifikasi tidak ditemukan setelah menekan VERIFY.', diagnosticFile: verifyDiag };
          }
          const code = await opts.verifier.askCode({ attempt, error: lastError });
          if (!code) return { kind: 'needs_verification', message: 'Kode verifikasi tidak dimasukkan (dibatalkan/timeout).', diagnosticFile: verifyDiag };

          if (inputs.length > 1) {
            await inputs[0].click();
            await page.keyboard.type(code, { delay: 80 });
          } else {
            await inputs[0].fill(code);
          }

          errIndex = loginErrors.length;
          const submit = page
            .locator('.modal-content button:visible, [class*=dialog] button:visible, [class*=verify] button:visible')
            .filter({ hasText: /verify|confirm|submit|ok|next|sign in|done|continue/i })
            .last();
          if (await submit.isVisible().catch(() => false)) await submit.click().catch(() => {});
          else await page.keyboard.press('Enter');

          outcome = await waitLoginOutcome(errIndex, 15_000);
          if (outcome === 'timeout' && !(await page.locator('.new-device-login').first().isVisible().catch(() => false))) {
            errIndex = loginErrors.length;
            await page.getByRole('button', { name: 'SIGN IN' }).last().click().catch(() => {});
            outcome = await waitLoginOutcome(errIndex, 15_000);
          }
          if (outcome === 'ok') verified = true;
          else if (typeof outcome === 'object') lastError = outcome.error.msg || `kode ${outcome.error.code}`;
          else if (outcome === 'challenge') {
            return { kind: 'needs_verification', message: 'Redfinger meminta verifikasi tambahan (CAPTCHA). Bot berhenti.', diagnosticFile: verifyDiag };
          } else lastError = 'Kode tidak diterima / tidak ada respons dari Redfinger.';
        }
        if (!verified) {
          pages.push({ step: 'code-failed', ...(await pageOutline(page)) });
          return { kind: 'needs_verification', message: `Verifikasi gagal setelah ${MAX_CODE_ATTEMPTS} percobaan: ${lastError ?? '-'}`, diagnosticFile: await diag('code-failed') };
        }
        return null;
      }
      if (outcome === 'ok') return null;
      if (outcome === 'challenge') {
        pages.push(await pageOutline(page));
        return { kind: 'needs_verification', message: 'Redfinger meminta verifikasi keamanan (CAPTCHA). Bot berhenti dan tidak mencoba melewatinya.', diagnosticFile: await diag('verify') };
      }
      if (typeof outcome === 'object') {
        const msg = outcome.error.msg;
        const kind = VERIFICATION_MSG.test(msg) ? 'needs_verification' : BAD_CREDENTIAL_MSG.test(msg) ? 'bad_credentials' : 'failed';
        return { kind, message: `Redfinger: ${msg || `kode ${outcome.error.code}`}`, diagnosticFile: null };
      }
      pages.push(await pageOutline(page));
      return { kind: 'failed', message: 'Login tidak selesai dalam 25 detik.', diagnosticFile: await diag('timeout') };
    };

    const loginFailure = await login();
    if (loginFailure) return loginFailure;

    const result = await fn({ page, api, pages, tag, diag });
    const state = await context
      .storageState()
      .then((s: any) => JSON.stringify(s))
      .catch(() => undefined);
    return { ...result, storageState: state };
  };

  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<Failure>((resolve) => {
      timer = setTimeout(
        () => resolve({ kind: 'failed', message: `Melebihi batas waktu ${Math.round((redfingerConfig.browser.timeoutMs + extraTimeoutMs) / 1000)} detik.`, diagnosticFile: null }),
        // + waktu tunggu admin memasukkan kode verifikasi (kalau ada verifier)
        redfingerConfig.browser.timeoutMs + extraTimeoutMs + (opts.verifier ? 25 * 60 * 1000 : 0)
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

/** Buka daftar cloud phone & kembalikan device hasil API getPadList. */
async function loadDevices(ctx: SessionContext): Promise<ParsedDevice[]> {
  const mark = ctx.api.length;
  await ctx.page.goto(PHONE_URL, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
  await ctx.page.waitForTimeout(3500);
  return extractDevices(ctx.api.slice(mark));
}

// ---------------------------------------------------------------------------------------------
// Operasi: sinkron device
// ---------------------------------------------------------------------------------------------

/**
 * Login + baca daftar device. `collectPages` = simpan juga struktur halaman Redeem Code &
 * Buy/Renew (read-only, tidak menekan apa pun) untuk kalibrasi.
 */
export async function loginAndSync(email: string, password: string, opts: SessionOptions & { collectPages?: boolean } = {}): Promise<SyncResult> {
  return runWithSession<{ kind: 'ok'; devices: ParsedDevice[]; diagnosticFile: string | null }>(email, password, { ...opts, tag: opts.tag ?? 'sync' }, async (ctx) => {
    const devices = await loadDevices(ctx);
    if (await hasVerification(ctx.page)) {
      ctx.pages.push(await pageOutline(ctx.page));
      return { kind: 'needs_verification', message: 'Halaman cloud phone meminta verifikasi keamanan. Bot berhenti.', diagnosticFile: await ctx.diag('verify') };
    }
    ctx.pages.push(await pageOutline(ctx.page));

    if (opts.collectPages) {
      for (const label of ['Redeem Code', 'Buy / Renew']) {
        const menu = ctx.page.getByText(label, { exact: true }).first();
        if (await menu.isVisible().catch(() => false)) {
          await menu.click().catch(() => {});
          await ctx.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
          await ctx.page.waitForTimeout(2500);
          ctx.pages.push({ menu: label, ...(await pageOutline(ctx.page)) });
        }
      }
    }

    const diagnosticFile = opts.collectPages || devices.length === 0 ? await ctx.diag('devices', { devicesParsed: devices.length }) : null;
    if (devices.length === 0) {
      return {
        kind: 'needs_calibration',
        message: 'Login berhasil, tetapi daftar device belum bisa dibaca otomatis (atau akun belum punya device). Struktur halaman sudah disimpan di server.',
        diagnosticFile,
      };
    }
    return { kind: 'ok', devices, diagnosticFile };
  }) as Promise<SyncResult>;
}

// ---------------------------------------------------------------------------------------------
// Operasi: REPLACE (halaman /app/device-replace)
//   Kartu device → ikon .device-card__setting → panel berisi "Device ID: VM…", versi sistem,
//   region, tombol REPLACE → halaman pilih "system version" (12.0/10.0/15.0/8.1) + "server"
//   (Thailand 38 ms, …) + "Lossless Replacement" + Rules + tombol REPLACE.
// ---------------------------------------------------------------------------------------------

export interface ReplaceServer {
  name: string;
  latency: string | null;
}
export interface ReplaceVersion {
  version: string;
  servers: ReplaceServer[];
}
export interface ReplaceOptions {
  /** padCode device (VM…) - hasil terjemahan bila yang diminta masih id lama (padId). */
  padCode: string;
  current: { version: string | null; region: string | null; deviceName: string | null };
  versions: ReplaceVersion[];
  rules: string | null;
}

export type ReplaceOptionsResult = ({ kind: 'ok'; options: ReplaceOptions; diagnosticFile: string | null } | Failure) & { storageState?: string };
export type ReplaceResult = (
  | { kind: 'ok'; message: string; padCode: string; devices: ParsedDevice[]; previousCodes: string[]; diagnosticFile: string | null }
  | Failure
) & { storageState?: string };

/** Dari daftar cloud phone, buka panel setting device `padCode` lalu tekan REPLACE di panel. */
async function openReplacePage(ctx: SessionContext, deviceId: string): Promise<{ current: ReplaceOptions['current']; padCode: string } | Failure> {
  const { page } = ctx;
  const mark = ctx.api.length;
  await page.goto(PHONE_URL, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(3500);
  // Terjemahkan id lama (padId numerik) → padCode yang tampil sebagai "Device ID" di panel.
  const listed = extractDevices(ctx.api.slice(mark));
  const target = listed.find((d) => d.remoteId === deviceId || d.altIds.includes(deviceId));
  const padCode = target?.remoteId ?? deviceId;

  // Panel setting yang sudah terbuka tidak tertutup dengan Escape dan menghalangi klik kartu lain,
  // jadi: coba kartu bernama sama dulu, lalu (kalau perlu) tiap kartu dengan halaman dimuat ulang.
  const cards = page.locator('.device-card');
  const count: number = await cards.count().catch(() => 0);
  const order: number[] = [];
  if (target?.name) {
    for (let i = 0; i < count; i++) {
      const name = String(await cards.nth(i).locator('.name').first().innerText().catch(() => '')).trim();
      if (name === target.name) order.push(i);
    }
  }
  for (let i = 0; i < count; i++) if (!order.includes(i)) order.push(i);

  const panelShows = async () => {
    const text: string = await page.locator('.phone-panel').first().innerText().catch(() => '');
    return new RegExp(`Device ID:\\s*${padCode}\\b`).test(text.replace(/\s+/g, ' '));
  };

  for (let attempt = 0; attempt < order.length; attempt++) {
    if (attempt > 0) {
      await page.goto(PHONE_URL, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(3000);
    }
    const setting = page.locator('.device-card').nth(order[attempt]).locator('.device-card__setting').first();
    if (!(await setting.isVisible().catch(() => false))) continue;
    await setting.click().catch(() => {});
    await page.waitForTimeout(2000);
    if (!(await panelShows())) continue;

    const current = await page
      .evaluate(() => {
        const doc = (globalThis as any).document;
        const txt = (sel: string) => (doc.querySelector(sel)?.textContent || '').trim() || null;
        return { version: txt('.sys-version'), region: txt('.single-line.tag'), deviceName: txt('.pad-name') };
      })
      .catch(() => ({ version: null, region: null, deviceName: null }));

    const replaceItem = page.getByText('REPLACE', { exact: true }).first();
    if (!(await replaceItem.isVisible().catch(() => false))) {
      ctx.pages.push(await pageOutline(page));
      return { kind: 'failed', message: 'Menu REPLACE tidak tersedia untuk device ini di Redfinger.', diagnosticFile: await ctx.diag('noreplace') };
    }
    await replaceItem.click();
    await page.waitForTimeout(4000);
    if (!/device-replace/.test(page.url())) {
      ctx.pages.push(await pageOutline(page));
      return { kind: 'failed', message: 'Halaman replace Redfinger tidak terbuka.', diagnosticFile: await ctx.diag('replace-nopage') };
    }
    return { current, padCode };
  }
  ctx.pages.push(await pageOutline(page));
  return { kind: 'failed', message: `Device ${padCode} tidak ditemukan di akun Redfinger ini.`, diagnosticFile: await ctx.diag('replace-nodevice') };
}

/** Item pilihan di bawah judul section (mis. "Please select system version"). */
async function sectionItems(page: any, titlePattern: string): Promise<{ name: string; tip: string | null; active: boolean }[]> {
  return page
    .evaluate((pattern: string) => {
      const doc = (globalThis as any).document;
      const re = new RegExp(pattern, 'i');
      const title = [...doc.querySelectorAll('.title')].find((el: any) => re.test(el.textContent || ''));
      if (!title) return [];
      let container = title.parentElement;
      for (let i = 0; i < 4 && container && container.querySelectorAll('.attr-name').length === 0; i++) container = container.parentElement;
      if (!container) return [];
      // Hanya item milik section ini (berhenti di judul section berikutnya)
      const items: any[] = [];
      let passedTitle = false;
      const walker = doc.createTreeWalker(container, 1 /* ELEMENT */);
      let node = walker.currentNode;
      while (node) {
        if (node === title) passedTitle = true;
        else if (passedTitle && node.classList?.contains('title') && node !== title) break;
        else if (passedTitle && node.classList?.contains('attr-name')) {
          const item = node.parentElement;
          const cls = String(item?.className || '') + ' ' + String(item?.parentElement?.className || '');
          items.push({
            name: (node.textContent || '').trim(),
            tip: (item?.querySelector('.attr-tip')?.textContent || '').trim() || null,
            active: /active|selected|checked|current/i.test(cls),
          });
        }
        node = walker.nextNode();
      }
      return items;
    }, titlePattern)
    .catch(() => []);
}

async function clickSectionItem(page: any, titlePattern: string, name: string): Promise<boolean> {
  // Tandai elemen target dengan atribut sementara (penelusuran sama seperti sectionItems), lalu klik.
  const marked: boolean = await page
    .evaluate(
      ({ pattern, value }: { pattern: string; value: string }) => {
        const doc = (globalThis as any).document;
        doc.querySelectorAll('[data-rf-pick]').forEach((el: any) => el.removeAttribute('data-rf-pick'));
        const re = new RegExp(pattern, 'i');
        const title = [...doc.querySelectorAll('.title')].find((el: any) => re.test(el.textContent || ''));
        if (!title) return false;
        let container = title.parentElement;
        for (let i = 0; i < 4 && container && container.querySelectorAll('.attr-name').length === 0; i++) container = container.parentElement;
        if (!container) return false;
        let passedTitle = false;
        const walker = doc.createTreeWalker(container, 1);
        let node = walker.currentNode;
        while (node) {
          if (node === title) passedTitle = true;
          else if (passedTitle && node.classList?.contains('title')) return false;
          else if (passedTitle && node.classList?.contains('attr-name') && (node.textContent || '').trim() === value) {
            (node.parentElement || node).setAttribute('data-rf-pick', '1');
            return true;
          }
          node = walker.nextNode();
        }
        return false;
      },
      { pattern: titlePattern, value: name }
    )
    .catch(() => false);
  if (!marked) return false;
  await page.locator('[data-rf-pick="1"]').first().click();
  return true;
}

const VERSION_TITLE = 'select system version';
const SERVER_TITLE = 'choose server';

/** Ambil kombinasi versi Android × server yang tersedia untuk replace device ini. */
export async function getReplaceOptions(email: string, password: string, padCode: string, opts: SessionOptions = {}): Promise<ReplaceOptionsResult> {
  return runWithSession<{ kind: 'ok'; options: ReplaceOptions; diagnosticFile: string | null }>(
    email,
    password,
    { ...opts, tag: opts.tag ?? 'replace-options' },
    async (ctx) => {
      const opened = await openReplacePage(ctx, padCode);
      if ('kind' in opened) return opened;
      const { page } = ctx;

      const versions = await sectionItems(page, VERSION_TITLE);
      if (versions.length === 0) {
        ctx.pages.push(await pageOutline(page));
        return { kind: 'needs_calibration', message: 'Pilihan versi sistem di halaman replace tidak terbaca.', diagnosticFile: await ctx.diag('replace-noversions') };
      }

      const result: ReplaceVersion[] = [];
      for (const v of versions) {
        await clickSectionItem(page, VERSION_TITLE, v.name);
        await page.waitForTimeout(2500);
        const servers = await sectionItems(page, SERVER_TITLE);
        result.push({ version: v.name, servers: servers.map((s) => ({ name: s.name, latency: s.tip })) });
      }
      const rules: string | null = await page
        .evaluate(() => {
          const doc = (globalThis as any).document;
          return [...doc.querySelectorAll('.desc')].map((el: any) => (el.textContent || '').trim()).filter(Boolean).join('\n') || null;
        })
        .catch(() => null);

      ctx.pages.push(await pageOutline(page));
      const diagnosticFile = await ctx.diag('replace-options', { versions: result.length });
      return { kind: 'ok', options: { padCode: opened.padCode, current: opened.current, versions: result, rules: rules?.slice(0, 1500) ?? null }, diagnosticFile };
    }
  ) as Promise<ReplaceOptionsResult>;
}

const CONFIRM_TEXT = /^(confirm|ok|yes|sure|replace|continue|agree|确定|确认)$/i;
const CANCEL_TEXT = /cancel|close|back|no\b|取消/i;

/**
 * Jalankan REPLACE di Redfinger untuk device `padCode` → versi `version` + server `server`.
 * Hasil ditentukan dari respons API Redfinger (resultCode) + daftar device sesudahnya.
 * Data di device lama terhapus sesuai aturan Redfinger - admin sudah mengonfirmasi di Discord.
 */
export async function performReplace(
  email: string,
  password: string,
  padCode: string,
  target: { version: string; server: string },
  opts: SessionOptions = {}
): Promise<ReplaceResult> {
  return runWithSession<{ kind: 'ok'; message: string; devices: ParsedDevice[]; previousCodes: string[]; diagnosticFile: string | null }>(
    email,
    password,
    { ...opts, tag: opts.tag ?? 'replace' },
    async (ctx) => {
      const { page } = ctx;
      const before = await loadDevices(ctx);
      const opened = await openReplacePage(ctx, padCode);
      if ('kind' in opened) return opened;

      if (!(await clickSectionItem(page, VERSION_TITLE, target.version))) {
        return { kind: 'failed', message: `Versi Android ${target.version} tidak tersedia lagi di halaman replace.`, diagnosticFile: await ctx.diag('replace-noversion') };
      }
      await page.waitForTimeout(2500);
      if (!(await clickSectionItem(page, SERVER_TITLE, target.server))) {
        return { kind: 'failed', message: `Server ${target.server} untuk Android ${target.version} tidak tersedia lagi.`, diagnosticFile: await ctx.diag('replace-noserver') };
      }
      await page.waitForTimeout(1500);

      const mark = ctx.api.length;
      const button = page.locator('button:visible, .button-inner:visible').filter({ hasText: /^\s*REPLACE\s*$/ }).last();
      if (!(await button.isVisible().catch(() => false))) {
        ctx.pages.push(await pageOutline(page));
        return { kind: 'failed', message: 'Tombol REPLACE tidak ditemukan.', diagnosticFile: await ctx.diag('replace-nobutton') };
      }
      await button.click();
      await page.waitForTimeout(3000);

      // Dialog konfirmasi Redfinger (kalau ada): tekan tombol setuju, bukan batal.
      for (let i = 0; i < 2; i++) {
        const dialogButtons = page.locator('ion-alert button:visible, ion-modal button:visible, [class*=dialog] button:visible, [class*=modal] button:visible, [class*=popup] button:visible');
        const n: number = await dialogButtons.count().catch(() => 0);
        let clicked = false;
        for (let j = n - 1; j >= 0; j--) {
          const b = dialogButtons.nth(j);
          const text = String(await b.innerText().catch(() => '')).trim();
          if (CONFIRM_TEXT.test(text) && !CANCEL_TEXT.test(text)) {
            ctx.pages.push({ step: `confirm-dialog-${i}`, ...(await pageOutline(page)) });
            await b.click().catch(() => {});
            clicked = true;
            break;
          }
        }
        if (!clicked) break;
        await page.waitForTimeout(3000);
      }

      // Tunggu respons API replace
      const deadline = Date.now() + 25_000;
      let apiResult: { path: string; code: number; msg: string } | null = null;
      while (Date.now() < deadline && !apiResult) {
        for (const entry of ctx.api.slice(mark)) {
          const j = entry.json;
          if (!j || typeof j.resultCode !== 'number') continue;
          if (/replace|change|exchange|switch/i.test(entry.path) || j.resultCode !== 0) {
            apiResult = { path: entry.path, code: j.resultCode, msg: String(j.resultMsg ?? (typeof j.resultInfo === 'string' ? j.resultInfo : '') ?? '') };
            if (j.resultCode !== 0 || /replace|change|exchange|switch/i.test(entry.path)) break;
          }
        }
        if (!apiResult) await page.waitForTimeout(1000);
      }
      ctx.pages.push({ step: 'after-replace', ...(await pageOutline(page)) });
      const diagnosticFile = await ctx.diag('replace-result', { target, apiResult });

      if (apiResult && apiResult.code !== 0) {
        return { kind: 'failed', message: `Redfinger menolak replace: ${apiResult.msg || `kode ${apiResult.code}`}`, diagnosticFile };
      }

      // Verifikasi dari daftar device sesudahnya
      await page.waitForTimeout(3000);
      const after = await loadDevices(ctx);
      const previousCodes = before.map((d) => d.remoteId);
      const changed = after.some((d) => !previousCodes.includes(d.remoteId)) || !after.some((d) => d.remoteId === opened.padCode);
      if (!apiResult && !changed) {
        return {
          kind: 'needs_calibration',
          message: 'Tombol REPLACE sudah ditekan tetapi belum ada konfirmasi dari Redfinger. Cek device di Redfinger; struktur layar tersimpan di server.',
          diagnosticFile,
        };
      }
      return { kind: 'ok', message: apiResult?.msg || 'Replace berhasil diproses Redfinger.', padCode: opened.padCode, devices: after, previousCodes, diagnosticFile };
    },
    60_000
  ) as Promise<ReplaceResult>;
}
