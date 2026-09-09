import { Interaction } from 'discord.js';
import { commands } from '../commands/index';
import { CustomId, parseCustomId } from '../types/customIds';
import { errorEmbed } from '../utils/embeds';

// Buttons
import { handleBuyRobux } from '../buttons/buyRobux';
import { handleOrderConfirm } from '../buttons/orderConfirm';
import { handleOrderCancelPrecheckout } from '../buttons/orderCancelPrecheckout';
import { handleTicketPay } from '../buttons/ticketPay';
import { handleTicketCallStaff } from '../buttons/ticketCallStaff';
import { handleTicketCancel } from '../buttons/ticketCancel';
import { handleTicketClose } from '../buttons/ticketClose';
import { handlePaymentVerify } from '../buttons/paymentVerify';
import { handlePaymentReject } from '../buttons/paymentReject';
import { handleOrderMarkCompleted } from '../buttons/orderMarkCompleted';
import { handleVerify } from '../buttons/verify';

// Select menus
import { handleRobuxAmountSelect } from '../selectMenus/handleRobuxAmountSelect';
import { handlePanelRobuxSelect } from '../selectMenus/handlePanelRobuxSelect';

// Modals
import { handleRobloxUsernameSubmit } from '../modals/handleRobloxUsernameSubmit';
import { handleRobuxCustomSubmit } from '../modals/handleRobuxCustomSubmit';

export async function handleInteraction(interaction: Interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commands.find((c) => c.data.name === interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
      return;
    }

    if (interaction.isButton()) {
      const { base, orderId, args } = parseCustomId(interaction.customId);

      switch (base) {
        case CustomId.BUY_ROBUX:
          return void (await handleBuyRobux(interaction));
        case CustomId.BUY_KOSTUM:
        case CustomId.BUY_REKBER:
          return void (await interaction.reply({ embeds: [errorEmbed('Fitur ini akan segera hadir. Saat ini baru tersedia pembelian Robux.')], ephemeral: true }));
        case CustomId.BUY_HISTORY:
          return void (await interaction.reply({ embeds: [errorEmbed('Gunakan command `/history` untuk melihat riwayat transaksi.')], ephemeral: true }));
        case CustomId.BUY_HELP:
          return void (await interaction.reply({
            embeds: [errorEmbed('Gunakan `/buy` untuk membeli Robux, `/pay` di dalam ticket untuk melihat info pembayaran, dan `/history` untuk riwayat transaksi. Butuh bantuan? Hubungi staff.').setColor(0x3498db)],
            ephemeral: true,
          }));
        case CustomId.ORDER_CONFIRM:
          return void (await handleOrderConfirm(interaction, args.slice(0)));
        case CustomId.ORDER_CANCEL_PRECHECKOUT:
          return void (await handleOrderCancelPrecheckout(interaction));
        case CustomId.TICKET_PAY:
          return void (await handleTicketPay(interaction, orderId!));
        case CustomId.TICKET_CALL_STAFF:
          return void (await handleTicketCallStaff(interaction));
        case CustomId.TICKET_CANCEL:
          return void (await handleTicketCancel(interaction, orderId!));
        case CustomId.TICKET_CLOSE:
          return void (await handleTicketClose(interaction, orderId!));
        case CustomId.PAYMENT_VERIFY:
          return void (await handlePaymentVerify(interaction, orderId!));
        case CustomId.PAYMENT_REJECT:
          return void (await handlePaymentReject(interaction, orderId!));
        case CustomId.ORDER_MARK_COMPLETED:
          return void (await handleOrderMarkCompleted(interaction, orderId!));
        case CustomId.VERIFY_BUTTON:
          return void (await handleVerify(interaction));
        default:
          return;
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === CustomId.SELECT_ROBUX_AMOUNT) {
        return void (await handleRobuxAmountSelect(interaction));
      }
      if (interaction.customId === CustomId.PANEL_ROBUX_SELECT) {
        return void (await handlePanelRobuxSelect(interaction));
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      const { base } = parseCustomId(interaction.customId);
      if (base === CustomId.MODAL_ROBLOX_USERNAME) {
        return void (await handleRobloxUsernameSubmit(interaction));
      }
      if (base === CustomId.MODAL_ROBUX_CUSTOM) {
        return void (await handleRobuxCustomSubmit(interaction));
      }
      return;
    }
  } catch (err) {
    console.error('[interactionCreate] Unhandled error:', err);
    const embed = errorEmbed('Terjadi kesalahan. Silakan hubungi staff.');
    try {
      if (interaction.isRepliable()) {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ embeds: [embed], ephemeral: true });
        } else {
          await interaction.reply({ embeds: [embed], ephemeral: true });
        }
      }
    } catch {
      // interaksi mungkin sudah expired, abaikan
    }
  }
}
