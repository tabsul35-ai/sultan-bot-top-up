// Semua custom_id interaksi Discord dikumpulkan di sini agar konsisten
// dan gampang ditelusuri antara file button/selectMenu/modal handler.

export const CustomId = {
  // /buy main menu
  BUY_ROBUX: 'buy_robux',
  BUY_KOSTUM: 'buy_kostum', // placeholder, belum diimplementasi
  BUY_REKBER: 'buy_rekber', // placeholder, belum diimplementasi
  BUY_HISTORY: 'buy_history',
  BUY_HELP: 'buy_help',

  // Modal: input username roblox
  MODAL_ROBLOX_USERNAME: 'modal_roblox_username',
  INPUT_ROBLOX_USERNAME: 'input_roblox_username',

  // Modal: jumlah Robux custom + username (dari opsi "Jumlah lain" di panel)
  MODAL_ROBUX_CUSTOM: 'modal_robux_custom',
  INPUT_ROBUX_AMOUNT: 'input_robux_amount',

  // Select menu: jumlah robux (dikirim setelah modal username disubmit)
  SELECT_ROBUX_AMOUNT: 'select_robux_amount',

  // Select menu panel permanen (dipasang di channel lewat /panel) - dipakai siapa saja, kapan saja
  PANEL_ROBUX_SELECT: 'panel_robux_select',

  // Confirmation buttons
  ORDER_CONFIRM: 'order_confirm',
  ORDER_CANCEL_PRECHECKOUT: 'order_cancel_precheckout',

  // Ticket buttons
  TICKET_PAY: 'ticket_pay',
  TICKET_CALL_STAFF: 'ticket_call_staff',
  TICKET_CANCEL: 'ticket_cancel',
  TICKET_CLOSE: 'ticket_close',

  // Staff verification buttons (muncul di ticket setelah user upload bukti)
  PAYMENT_VERIFY: 'payment_verify',
  PAYMENT_REJECT: 'payment_reject',

  // Admin: tandai robux sudah dikirim manual
  ORDER_MARK_COMPLETED: 'order_mark_completed',

  // Panel verifikasi member (dipasang lewat /setup-verify)
  VERIFY_BUTTON: 'verify_button',
} as const;

// Helper untuk custom_id yang perlu menyisipkan argumen, contoh: "payment_verify:cksdf123" atau "order_confirm:1000:160000"
export function buildCustomId(base: string, ...args: (string | number)[]): string {
  return [base, ...args].join(':');
}

export function parseCustomId(customId: string): { base: string; args: string[]; orderId?: string } {
  const [base, ...args] = customId.split(':');
  return { base, args, orderId: args[0] };
}
