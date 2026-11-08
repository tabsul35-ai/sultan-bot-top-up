import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { redfingerConfig } from '../../config/config';

/**
 * Enkripsi password akun Redfinger dengan AES-256-GCM. Kunci diambil dari env
 * REDFINGER_ENCRYPTION_KEY (32 byte, base64 atau hex) - tidak pernah di-hardcode / disimpan di DB.
 *
 * Format tersimpan: "v1:<iv base64>:<authTag base64>:<ciphertext base64>".
 * Password hanya didekripsi saat dibutuhkan otomasi browser, dan TIDAK PERNAH dikirim ke Discord.
 *
 * Buat kunci baru:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * PERINGATAN: kunci yang hilang/diganti = semua password tersimpan tidak bisa dibaca lagi.
 */

let cachedKey: Buffer | null | undefined;

function loadKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;

  const raw = redfingerConfig.encryptionKey.trim();
  if (!raw) return (cachedKey = null);

  let key: Buffer | null = null;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === 32) key = b64;
  }

  if (!key) {
    console.error('⚠️ REDFINGER_ENCRYPTION_KEY tidak valid (harus 32 byte dalam base64 atau 64 karakter hex). Penyimpanan password dinonaktifkan.');
  }
  return (cachedKey = key);
}

export function isEncryptionConfigured(): boolean {
  return loadKey() !== null;
}

export function encryptSecret(plain: string): string {
  const key = loadKey();
  if (!key) throw new Error('REDFINGER_ENCRYPTION_KEY belum diatur / tidak valid.');

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptSecret(stored: string): string {
  const key = loadKey();
  if (!key) throw new Error('REDFINGER_ENCRYPTION_KEY belum diatur / tidak valid.');

  const [version, ivB64, tagB64, dataB64] = stored.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) throw new Error('Format password terenkripsi tidak dikenali.');

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Gagal mendekripsi password (kunci REDFINGER_ENCRYPTION_KEY berbeda dari saat password disimpan?).');
  }
}
