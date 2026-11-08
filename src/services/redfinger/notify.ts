import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  MessageCreateOptions,
  TextChannel,
} from 'discord.js';
import { getBotSetting, getRedfingerSetting, prisma } from '../../database/prisma';
import { BRAND } from '../../config/config';
import { CustomId, buildCustomId } from '../../types/customIds';

/**
 * Channel admin untuk pengingat & notifikasi job: RedfingerSetting.adminChannelId, fallback ke
 * log channel toko (/admin setchannel). Null kalau dua-duanya belum diatur.
 */
async function resolveAdminChannel(client: Client, guildId: string): Promise<TextChannel | null> {
  const rfSetting = await getRedfingerSetting(guildId);
  const channelId = rfSetting.adminChannelId ?? (await getBotSetting(guildId)).logChannelId;
  if (!channelId) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  return channel instanceof TextChannel ? channel : null;
}

/**
 * Kirim pesan ke channel admin Redfinger, me-mention role Redfinger kalau ada.
 * Return true kalau terkirim. Jangan pernah memasukkan password ke payload ini.
 */
export async function sendAdminNotification(
  client: Client,
  guildId: string,
  payload: { embeds: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[]; mentionRole?: boolean }
): Promise<boolean> {
  try {
    const channel = await resolveAdminChannel(client, guildId);
    if (!channel) {
      console.warn(`[redfinger] Channel admin belum diatur untuk guild ${guildId} - notifikasi tidak terkirim. Jalankan /redfinger setup.`);
      return false;
    }

    const rfSetting = await getRedfingerSetting(guildId);
    const options: MessageCreateOptions = { embeds: payload.embeds, components: payload.components ?? [] };
    if (payload.mentionRole && rfSetting.adminRoleId) {
      options.content = `<@&${rfSetting.adminRoleId}>`;
      options.allowedMentions = { roles: [rfSetting.adminRoleId] };
    } else {
      options.allowedMentions = { parse: [] };
    }

    await channel.send(options);
    return true;
  } catch (err) {
    console.error('[redfinger] Gagal mengirim notifikasi admin:', err);
    return false;
  }
}

/**
 * Catat tindakan penting ke RedfingerAuditLog (selalu) dan ke channel log Redfinger (kalau diatur
 * lewat /redfinger setup log_channel). `actorId` null = sistem (scheduler/job).
 */
export async function logRedfingerAction(
  client: Client,
  params: {
    guildId: string;
    accountId?: string | null;
    action: string;
    title: string;
    message: string;
    actorId?: string | null;
    color?: number;
  }
): Promise<void> {
  // Database dulu - jangan sampai audit hilang karena masalah Discord API.
  try {
    await prisma.redfingerAuditLog.create({
      data: {
        guildId: params.guildId,
        accountId: params.accountId ?? null,
        action: params.action,
        message: params.message,
        actorId: params.actorId ?? null,
      },
    });
  } catch (err) {
    console.error('[redfinger] Gagal menyimpan audit log:', err);
  }

  try {
    const rfSetting = await getRedfingerSetting(params.guildId);
    if (!rfSetting.logChannelId) return;

    const channel = await client.channels.fetch(rfSetting.logChannelId).catch(() => null);
    if (!(channel instanceof TextChannel)) return;

    const embed = new EmbedBuilder()
      .setColor(params.color ?? BRAND.color)
      .setTitle(params.title)
      .setDescription(`${params.message}\n\n${params.actorId ? `Oleh: <@${params.actorId}>` : 'Oleh: sistem'}`)
      .setFooter({ text: `Redfinger · ${params.action}` })
      .setTimestamp();

    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('[redfinger] Gagal mengirim audit log ke channel:', err);
  }
}

/** Tombol di notifikasi pengingat: Renew / Replace / Tandai Selesai. */
export function reminderButtons(accountId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_RENEW, accountId)).setLabel('Renew').setEmoji('🔄').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_REPLACE, accountId)).setLabel('Replace').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_DONE, accountId)).setLabel('Tandai Selesai').setEmoji('✅').setStyle(ButtonStyle.Success)
  );
}

/** Tombol checklist renew manual / setelah job perlu verifikasi. */
export function renewProgressButtons(accountId: string, opts: { recheck?: boolean } = {}): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId(CustomId.RF_DONE, accountId))
      .setLabel('Tandai Selesai (isi jatuh tempo baru)')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
  );
  if (opts.recheck) {
    row.addComponents(
      new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_RECHECK, accountId)).setLabel('Cek Ulang via Browser').setEmoji('🌐').setStyle(ButtonStyle.Primary)
    );
  }
  row.addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_FAIL, accountId)).setLabel('Tandai Gagal').setEmoji('❌').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_CANCEL, accountId)).setLabel('Batalkan').setStyle(ButtonStyle.Secondary)
  );
  return row;
}

/** Tombol saat proses replace dimulai. */
export function replaceProgressButtons(accountId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId(CustomId.RF_REPLACE_FORM, accountId))
      .setLabel('Isi Data Pengganti')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_FAIL, accountId)).setLabel('Tandai Gagal').setEmoji('❌').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(buildCustomId(CustomId.RF_CANCEL, accountId)).setLabel('Batalkan').setStyle(ButtonStyle.Secondary)
  );
}
