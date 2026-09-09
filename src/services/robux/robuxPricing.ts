export const ROBUX_MIN = 100;
export const ROBUX_MAX = 2000;
export const ROBUX_STEP = 100;

// Batas untuk jumlah Robux "custom" yang diketik sendiri user lewat panel.
export const ROBUX_CUSTOM_MIN = 50;
export const ROBUX_CUSTOM_MAX = 20000;

/**
 * Daftar pilihan Robux untuk select menu: 100, 200, ..., 2000
 */
export function getRobuxOptions(): number[] {
  const options: number[] = [];
  for (let amount = ROBUX_MIN; amount <= ROBUX_MAX; amount += ROBUX_STEP) {
    options.push(amount);
  }
  return options;
}

/**
 * Validasi jumlah robux untuk pilihan cepat (dropdown): kelipatan 100, antara 100-2000.
 */
export function isValidRobuxAmount(amount: number): boolean {
  if (!Number.isInteger(amount)) return false;
  if (amount < ROBUX_MIN || amount > ROBUX_MAX) return false;
  if (amount % ROBUX_STEP !== 0) return false;
  return true;
}

/**
 * Validasi jumlah robux yang boleh diproses jadi order (termasuk jumlah custom):
 * bilangan bulat antara ROBUX_CUSTOM_MIN dan ROBUX_CUSTOM_MAX. Tidak wajib kelipatan 100.
 * Dipakai sebagai gerbang terakhir sebelum order dibuat.
 */
export function isAllowedRobuxAmount(amount: number): boolean {
  if (!Number.isInteger(amount)) return false;
  return amount >= ROBUX_CUSTOM_MIN && amount <= ROBUX_CUSTOM_MAX;
}

/**
 * Hitung harga berdasarkan harga per unit yang dikonfigurasi admin (default Rp160/Robux).
 */
export function calculateRobuxPrice(amount: number, pricePerUnit: number): number {
  return amount * pricePerUnit;
}

export function formatRupiah(amount: number): string {
  return 'Rp' + amount.toLocaleString('id-ID');
}
