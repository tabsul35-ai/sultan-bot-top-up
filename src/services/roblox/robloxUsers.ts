/**
 * Lookup username Roblox lewat API publik (tidak perlu cookie/login) - dipakai untuk memastikan
 * buyer benar-benar mengetik username yang ada di Roblox, sebelum order dibuat. Penting karena
 * pengiriman Robux memakai username ini apa adanya (fitur "Send Robux" Roblox by username) -
 * typo bisa berarti salah kirim atau gagal kirim.
 */

export type UsernameCheckResult =
  | { status: 'found'; id: number; name: string }
  | { status: 'not_found' }
  | { status: 'unknown' }; // Roblox API lagi bermasalah/timeout - JANGAN blokir user karena ini

export async function checkRobloxUsername(username: string): Promise<UsernameCheckResult> {
  try {
    const res = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
      signal: AbortSignal.timeout(2500),
    });

    if (!res.ok) throw new Error(`Roblox username lookup HTTP ${res.status}`);

    const data = (await res.json()) as { data?: { id: number; name: string }[] };
    const match = data.data?.[0];
    return match ? { status: 'found', id: match.id, name: match.name } : { status: 'not_found' };
  } catch (err) {
    console.warn('[roblox users] Gagal cek username Roblox (dilewati, tidak memblokir user):', err instanceof Error ? err.message : err);
    return { status: 'unknown' };
  }
}
