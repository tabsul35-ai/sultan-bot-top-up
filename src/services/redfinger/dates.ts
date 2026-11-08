import { redfingerConfig } from '../../config/config';

/**
 * Utilitas tanggal Redfinger. Semua input/tampilan teks memakai zona waktu tetap
 * REDFINGER_UTC_OFFSET_HOURS (default 7 = WIB; Indonesia tidak memakai DST), sementara di
 * database tetap disimpan sebagai UTC biasa.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function offsetMs(): number {
  return redfingerConfig.utcOffsetHours * 60 * 60 * 1000;
}

export function tzLabel(): string {
  const h = redfingerConfig.utcOffsetHours;
  if (h === 7) return 'WIB';
  if (h === 8) return 'WITA';
  if (h === 9) return 'WIT';
  return `UTC${h >= 0 ? '+' : ''}${h}`;
}

/** Bangun Date dari komponen waktu lokal (zona REDFINGER_UTC_OFFSET_HOURS). */
function fromLocal(y: number, mo: number, d: number, h: number, mi: number, s = 0): Date | null {
  const utc = Date.UTC(y, mo - 1, d, h, mi, s) - offsetMs();
  const date = new Date(utc);
  // Tolak tanggal yang "meluber" (mis. 31 Februari)
  const check = new Date(utc + offsetMs());
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  if (h > 23 || mi > 59 || s > 59) return null;
  return date;
}

/**
 * Parse input tanggal dari admin. Format yang diterima:
 * - "2026-12-31" / "2026-12-31 14:30"   (tanpa jam = 23:59)
 * - "31/12/2026" / "31-12-2026 14:30"
 * - "+30"  = 30 hari setelah `base` (default: sekarang)
 * Return null kalau format tidak dikenali.
 */
export function parseDateInput(input: string, base: Date = new Date()): Date | null {
  const text = input.trim();

  const rel = /^\+\s*(\d{1,3})$/.exec(text);
  if (rel) return new Date(base.getTime() + Number(rel[1]) * DAY_MS);

  const time = (h?: string, mi?: string, s?: string) => (h === undefined ? [23, 59, 0] : [Number(h), Number(mi), Number(s ?? 0)]);

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (iso) {
    const [h, mi, s] = time(iso[4], iso[5], iso[6]);
    return fromLocal(Number(iso[1]), Number(iso[2]), Number(iso[3]), h, mi, s);
  }

  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (dmy) {
    const [h, mi, s] = time(dmy[4], dmy[5], dmy[6]);
    return fromLocal(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]), h, mi, s);
  }

  return null;
}

export function dateInputHint(): string {
  return `Format: YYYY-MM-DD, YYYY-MM-DD HH:mm, DD/MM/YYYY, atau +30 (hari). Zona waktu ${tzLabel()}.`;
}

/** "2026-12-31 23:59" di zona lokal - dipakai untuk prefill modal. */
export function formatDateInput(date: Date): string {
  const local = new Date(date.getTime() + offsetMs());
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

/** Timestamp Discord: dirender otomatis di zona waktu masing-masing pembaca. */
export function discordTime(date: Date, style: 'f' | 'F' | 'd' | 'D' | 'R' = 'f'): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

/** "31 Des 2026 23:59 WIB (dalam 5 hari)" - untuk embed. */
export function formatDue(date: Date): string {
  return `${discordTime(date, 'f')} (${discordTime(date, 'R')})`;
}

function localDayIndex(date: Date): number {
  return Math.floor((date.getTime() + offsetMs()) / DAY_MS);
}

/**
 * Selisih hari KALENDER (zona lokal) dari `now` ke `due`. 0 = jatuh tempo hari ini,
 * negatif = sudah lewat harinya. Untuk status "sudah habis" pakai perbandingan waktu langsung.
 */
export function calendarDaysLeft(due: Date, now: Date = new Date()): number {
  return localDayIndex(due) - localDayIndex(now);
}

export function startOfLocalToday(now: Date = new Date()): Date {
  return new Date(localDayIndex(now) * DAY_MS - offsetMs());
}
