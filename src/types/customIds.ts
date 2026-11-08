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

  // Modal admin: tambah akun Roblox untuk stok live (lihat /admin addrobloxaccount)
  MODAL_ROBLOX_ACCOUNT: 'modal_roblox_account',
  INPUT_ROBLOX_ACCOUNT_LABEL: 'input_roblox_account_label',
  INPUT_ROBLOX_COOKIE: 'input_roblox_cookie',

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
  TICKET_DONE: 'ticket_done', // staff: tandai pesanan selesai lalu tutup ticket
  TICKET_CLOSE: 'ticket_close',

  // Staff verification buttons (muncul di ticket setelah user upload bukti)
  PAYMENT_VERIFY: 'payment_verify',
  PAYMENT_REJECT: 'payment_reject',

  // Admin: tandai robux sudah dikirim manual
  ORDER_MARK_COMPLETED: 'order_mark_completed',

  // Panel verifikasi member (dipasang lewat /setup-verify)
  VERIFY_BUTTON: 'verify_button',

  // ===== Manajemen akun Redfinger (/redfinger) - semua diawali "rf_", argumen = id akun =====
  RF_RENEW: 'rf_renew', // mulai renew (dari notifikasi pengingat)
  RF_REPLACE: 'rf_replace', // mulai replace (dari notifikasi pengingat)
  RF_DONE: 'rf_done', // tandai renew selesai -> modal tanggal jatuh tempo baru
  RF_FAIL: 'rf_fail', // tandai renew/replace gagal
  RF_CANCEL: 'rf_cancel', // batalkan proses renew/replace yang sedang berjalan
  RF_RECHECK: 'rf_recheck', // jalankan ulang job browser (setelah admin verifikasi manual)
  RF_REPLACE_FORM: 'rf_replace_form', // buka modal data akun pengganti
  RF_DELETE_CONFIRM: 'rf_delete_confirm', // rf_delete_confirm:<id>:<discordId peminta>
  RF_DELETE_CANCEL: 'rf_delete_cancel',
  RF_DELETE: 'rf_delete', // minta konfirmasi hapus (dari menu kelola panel)
  RF_DISABLE: 'rf_disable',
  RF_ENABLE: 'rf_enable',
  RF_PASSWORD: 'rf_password', // buka modal ganti/hapus password

  // Panel Redfinger permanen di channel (/redfinger panel) - tanpa argumen
  RF_PANEL_ADD: 'rf_panel_add',
  RF_PANEL_LIST: 'rf_panel_list',
  RF_PANEL_MANAGE: 'rf_panel_manage',
  RF_PANEL_SETUP: 'rf_panel_setup',
  RF_PANEL_SELECT: 'rf_panel_select', // select menu pilih akun

  // Redfinger Manager (panel baru): login akun Redfinger + aksi per device
  RF_PANEL_REGISTER: 'rf_panel_register',
  RF_PANEL_REDEEM: 'rf_panel_redeem',
  RF_PANEL_REPLACE: 'rf_panel_replace',
  RF_PANEL_RENEW: 'rf_panel_renew',
  RF_PANEL_LOGOUT: 'rf_panel_logout',
  RF_PANEL_RETRY: 'rf_panel_retry',
  RF_PICK_RENEW: 'rf_pick_renew', // select device -> renew
  RF_PICK_REPLACE: 'rf_pick_replace', // select device -> replace
  RF_PICK_LOGOUT: 'rf_pick_logout', // select login -> konfirmasi logout
  RF_PICK_SYNC: 'rf_pick_sync', // select login -> sinkron sekarang
  RF_LOGOUT_CONFIRM: 'rf_logout_confirm', // rf_logout_confirm:<loginId>:<discordId peminta>
  RF_MODAL_REGISTER: 'rf_modal_register',
  // Verifikasi perangkat baru Redfinger (argumen = id tugas)
  RF_VSEND: 'rf_vsend', // admin setuju kode dikirim ke email
  RF_VCODE: 'rf_vcode', // buka modal input kode
  RF_VCANCEL: 'rf_vcancel',
  RF_MODAL_VCODE: 'rf_modal_vcode',
  RF_INPUT_VCODE: 'rf_input_vcode',
  RF_INPUT_EMAIL: 'rf_input_email',

  // Modal Redfinger
  RF_MODAL_ADD: 'rf_modal_add', // rf_modal_add[:YYYY-MM-DD tanggal mulai]
  RF_MODAL_DUE: 'rf_modal_due', // rf_modal_due:<id>
  RF_MODAL_REPLACE: 'rf_modal_replace', // rf_modal_replace:<id akun lama>
  RF_MODAL_PASSWORD: 'rf_modal_password', // rf_modal_password:<id>
  RF_INPUT_LABEL: 'rf_input_label',
  RF_INPUT_USERNAME: 'rf_input_username',
  RF_INPUT_PASSWORD: 'rf_input_password',
  RF_INPUT_INSTANCE: 'rf_input_instance',
  RF_INPUT_DUE: 'rf_input_due',
  RF_INPUT_NOTES: 'rf_input_notes',
} as const;

// Helper untuk custom_id yang perlu menyisipkan argumen, contoh: "payment_verify:cksdf123" atau "order_confirm:1000:160000"
export function buildCustomId(base: string, ...args: (string | number)[]): string {
  return [base, ...args].join(':');
}

export function parseCustomId(customId: string): { base: string; args: string[]; orderId?: string } {
  const [base, ...args] = customId.split(':');
  return { base, args, orderId: args[0] };
}
