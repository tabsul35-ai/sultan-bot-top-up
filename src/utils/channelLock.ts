import { ChannelType, Guild, PermissionFlagsBits } from 'discord.js';
import { getBotSetting } from '../database/prisma';

export type LockResult = { changed: number; skipped: number; failed: number; note: string };

/**
 * Kunci seluruh channel server: `@everyone` tidak bisa melihat channel,
 * sedangkan role verifikasi (+ role staff/admin bila diset) tetap bisa.
 * Channel verifikasi (tersimpan lewat /setup-verify) dibiarkan publik.
 *
 * Channel yang permission-nya masih sinkron ke kategori dilewati - cukup kategorinya yang diatur.
 */
export async function lockGuild(guild: Guild): Promise<LockResult> {
  const setting = await getBotSetting();
  const me = guild.members.me;

  if (!me || !me.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles])) {
    return { changed: 0, skipped: 0, failed: 0, note: 'Bot butuh izin **Manage Channels** + **Manage Roles**.' };
  }
  if (!setting.verifiedRoleId) {
    return { changed: 0, skipped: 0, failed: 0, note: 'Role verifikasi belum diatur. Jalankan `/admin setroles verified:@Role` dulu.' };
  }
  if (!setting.verifyChannelId) {
    return {
      changed: 0,
      skipped: 0,
      failed: 0,
      note: 'Panel verifikasi belum dipasang. Jalankan `/setup-verify` di channel verifikasi dulu supaya channel itu tidak ikut terkunci.',
    };
  }

  const everyoneId = guild.roles.everyone.id;
  // Bot sendiri ikut di-allow supaya tetap bisa melihat & mengelola channel setelah lockdown.
  const allowIds = [me.id, setting.verifiedRoleId, setting.staffRoleId, setting.adminRoleId].filter(
    (x): x is string => !!x
  );

  let changed = 0;
  let skipped = 0;
  let failed = 0;

  for (const channel of guild.channels.cache.values()) {
    if (channel.isThread()) continue;
    const isCategory = channel.type === ChannelType.GuildCategory;

    try {
      if (channel.id === setting.verifyChannelId) {
        await channel.permissionOverwrites.edit(everyoneId, { ViewChannel: true });
        skipped++;
        continue;
      }

      // Jangan sentuh kategori ticket & channel ticket di dalamnya - visibilitasnya
      // sudah diatur sendiri per-ticket (privat untuk customer + staff).
      if (
        setting.orderCategoryId &&
        (channel.id === setting.orderCategoryId || channel.parentId === setting.orderCategoryId)
      ) {
        skipped++;
        continue;
      }

      // Channel yang masih ikut kategori: cukup atur kategorinya saja.
      if (!isCategory && channel.parentId && channel.permissionsLocked) {
        skipped++;
        continue;
      }

      await channel.permissionOverwrites.edit(everyoneId, { ViewChannel: false });
      for (const rid of allowIds) {
        await channel.permissionOverwrites.edit(rid, { ViewChannel: true });
      }
      changed++;
    } catch (err) {
      console.error(`[lockGuild] gagal mengatur channel ${channel.id}:`, err);
      failed++;
    }
  }

  return { changed, skipped, failed, note: '' };
}

/**
 * Kembalikan seperti semula: hapus larangan "tidak bisa lihat" untuk `@everyone`
 * di semua channel. Permission role lain dibiarkan.
 */
export async function unlockGuild(guild: Guild): Promise<LockResult> {
  const me = guild.members.me;
  if (!me || !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return { changed: 0, skipped: 0, failed: 0, note: 'Bot butuh izin **Manage Channels**.' };
  }

  const everyoneId = guild.roles.everyone.id;
  let changed = 0;
  let failed = 0;

  for (const channel of guild.channels.cache.values()) {
    if (channel.isThread()) continue;
    try {
      await channel.permissionOverwrites.edit(everyoneId, { ViewChannel: null });
      changed++;
    } catch (err) {
      console.error(`[unlockGuild] gagal mengatur channel ${channel.id}:`, err);
      failed++;
    }
  }

  return { changed, skipped: 0, failed, note: '' };
}
