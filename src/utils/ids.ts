/**
 * Generate Order ID unik dengan format ST-XXXXXX (6 digit angka acak).
 * Dipanggil ulang jika collision terjadi (dicek di orderService).
 */
export function generateOrderCode(): string {
  const random = Math.floor(100000 + Math.random() * 900000); // 6 digit
  return `ST-${random}`;
}

/**
 * Format nama channel ticket, aman untuk Discord (lowercase, tanpa spasi/simbol aneh).
 */
export function sanitizeChannelName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 90) || 'user';
}
