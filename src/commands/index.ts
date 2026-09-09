import { ChatInputCommandInteraction, SlashCommandBuilder, SlashCommandSubcommandsOnlyBuilder } from 'discord.js';
import * as buy from './buy';
import * as pay from './pay';
import * as history from './history';
import * as ping from './ping';
import * as admin from './admin';
import * as panel from './panel';
import * as setupVerify from './setup-verify';
import * as lockdown from './lockdown';
import * as unlock from './unlock';

export interface BotCommand {
  data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder | any;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export const commands: BotCommand[] = [buy, pay, history, ping, admin, panel, setupVerify, lockdown, unlock];
