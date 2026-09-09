import { ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { getRobuxOptions } from '../services/robux/robuxPricing';
import { CustomId } from '../types/customIds';

export function buildRobuxAmountSelect(): ActionRowBuilder<StringSelectMenuBuilder> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(CustomId.SELECT_ROBUX_AMOUNT)
    .setPlaceholder('Pilih jumlah Robux')
    .addOptions(
      getRobuxOptions().map((amount) => ({
        label: `${amount.toLocaleString('id-ID')} Robux`,
        value: String(amount),
      }))
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}
