import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config/config';
import { deployCommands } from './commands/deploy-commands';
import { handleInteraction } from './events/interactionCreate';
import { handlePossiblePaymentProof } from './events/paymentProofListener';
import { prisma } from './database/prisma';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // dibutuhkan untuk membaca attachment bukti pembayaran
  ],
  partials: [Partials.Channel],
});

client.once('ready', async () => {
  console.log(`👑 Sultan Top Up Bot online sebagai ${client.user?.tag}`);
  try {
    await deployCommands();
  } catch (err) {
    console.error('⚠️ Gagal mendaftarkan slash command otomatis (bot tetap jalan):', err);
  }
});

client.on('interactionCreate', (interaction) => {
  void handleInteraction(interaction);
});

client.on('messageCreate', (message) => {
  void handlePossiblePaymentProof(message);
});

async function main() {
  await prisma.$connect();
  console.log('✅ Terhubung ke database.');
  await client.login(config.discordToken);
}

main().catch((err) => {
  console.error('❌ Gagal menjalankan bot:', err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  client.destroy();
  process.exit(0);
});
