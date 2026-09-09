import { EmbedBuilder } from 'discord.js';
import { BRAND } from '../config/config';

export function baseEmbed(): EmbedBuilder {
  return new EmbedBuilder().setColor(BRAND.color).setFooter({ text: BRAND.name });
}

export function errorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND.errorColor)
    .setDescription(`❌ ${message}`)
    .setFooter({ text: BRAND.name });
}

export function successEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND.successColor)
    .setDescription(`✅ ${message}`)
    .setFooter({ text: BRAND.name });
}
