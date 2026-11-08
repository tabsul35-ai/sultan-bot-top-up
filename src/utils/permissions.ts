import { GuildMember, PermissionFlagsBits } from 'discord.js';
import { getBotSetting, getRedfingerSetting } from '../database/prisma';

/**
 * Staff atau Admin: pemilik server (ManageGuild) selalu dianggap boleh, ditambah role yang dikonfigurasi.
 */
export async function isStaffOrAdmin(member: GuildMember): Promise<boolean> {
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;

  const setting = await getBotSetting(member.guild.id);
  if (setting.staffRoleId && member.roles.cache.has(setting.staffRoleId)) return true;
  if (setting.adminRoleId && member.roles.cache.has(setting.adminRoleId)) return true;
  return false;
}

/**
 * Admin saja (untuk /admin settings yang sensitif seperti mengubah harga/payment).
 */
export async function isAdmin(member: GuildMember): Promise<boolean> {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  const setting = await getBotSetting(member.guild.id);
  if (setting.adminRoleId && member.roles.cache.has(setting.adminRoleId)) return true;
  return false;
}

/**
 * Boleh memakai /redfinger: admin toko (lihat isAdmin) ATAU role khusus Redfinger yang diatur
 * lewat /redfinger setup role:@role.
 */
export async function isRedfingerAdmin(member: GuildMember): Promise<boolean> {
  if (await isAdmin(member)) return true;

  const setting = await getRedfingerSetting(member.guild.id);
  return Boolean(setting.adminRoleId && member.roles.cache.has(setting.adminRoleId));
}
