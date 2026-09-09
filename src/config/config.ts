import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} wajib diisi (cek file .env)`);
  }
  return value;
}

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  guildId: process.env.DISCORD_GUILD_ID || '', // opsional, untuk deploy command per-guild (lebih cepat saat dev)
  databaseUrl: required('DATABASE_URL'),
};

export const BRAND = {
  name: 'SULTAN TOP UP',
  emoji: '👑',
  color: 0xf1c40f, // gold
  errorColor: 0xe74c3c,
  successColor: 0x2ecc71,
  pendingColor: 0xf39c12,
};
