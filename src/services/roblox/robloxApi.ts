/**
 * Klien tipis ke API privat Roblox untuk membaca saldo Robux akun penjual (dipakai sebagai
 * "stok" live). Autentikasi pakai cookie sesi `.ROBLOSECURITY` milik akun penjual sendiri -
 * BUKAN OAuth/API resmi publik, jadi harus dijaga seperti password.
 *
 * PERINGATAN: siapa pun yang punya cookie ini bisa login penuh sebagai akun tersebut
 * (transfer Robux, ganti password, dll). Jangan pernah log/print isinya, jangan commit ke
 * git, dan sebaiknya pakai akun Roblox terpisah khusus jualan (bukan akun utama).
 */

const USER_AGENT = 'SultanTopUpBot/1.0 (+https://sultantopup.cloud)';

export class RobloxAuthError extends Error {}

interface RobloxResult<T> {
  data: T;
  /** Roblox kadang merotasi cookie sesi dan mengirim yang baru lewat header Set-Cookie. */
  rotatedCookie: string | null;
}

function extractRotatedCookie(res: Response): string | null {
  const raw =
    typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (res.headers as { getSetCookie: () => string[] }).getSetCookie()
      : [res.headers.get('set-cookie') ?? ''];

  for (const line of raw) {
    const match = /\.ROBLOSECURITY=([^;]+)/.exec(line);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

async function robloxGet<T>(url: string, cookie: string): Promise<RobloxResult<T>> {
  const res = await fetch(url, {
    headers: {
      Cookie: `.ROBLOSECURITY=${cookie}`,
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });

  const rotatedCookie = extractRotatedCookie(res);

  if (res.status === 401 || res.status === 403) {
    throw new RobloxAuthError(`Roblox menolak akses (HTTP ${res.status}) - cookie ROBLOX_COOKIE kedaluwarsa/tidak valid.`);
  }
  if (!res.ok) {
    throw new Error(`Roblox API mengembalikan HTTP ${res.status} saat memanggil ${new URL(url).pathname}.`);
  }

  return { data: (await res.json()) as T, rotatedCookie };
}

/**
 * Ambil saldo Robux akun yang cookie-nya dipakai (userId ditentukan otomatis dari cookie itu
 * sendiri, jadi tidak bisa dipakai untuk mengintip saldo akun lain).
 */
export async function fetchRobuxStock(
  cookie: string
): Promise<{ robux: number; robloxUsername: string; rotatedCookie: string | null }> {
  const auth = await robloxGet<{ id?: number; name?: string }>('https://users.roblox.com/v1/users/authenticated', cookie);
  const userId = auth.data.id;
  if (!userId) {
    throw new RobloxAuthError('Tidak bisa membaca akun Roblox dari cookie (respons tidak berisi id user).');
  }

  const currency = await robloxGet<{ robux?: number }>(`https://economy.roblox.com/v1/users/${userId}/currency`, cookie);
  if (typeof currency.data.robux !== 'number') {
    throw new Error('Respons saldo Robux dari Roblox tidak sesuai format yang diharapkan.');
  }

  return {
    robux: currency.data.robux,
    robloxUsername: auth.data.name ?? '(tidak diketahui)',
    rotatedCookie: currency.rotatedCookie ?? auth.rotatedCookie,
  };
}
