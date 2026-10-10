// electron/security/riskPolicy.ts
//
// Central risk classification for every tool Anushka can invoke.
// Nothing in this app calls a raw shell/PowerShell/Python string built from
// AI text. The AI only ever picks a tool NAME + structured arguments; this
// file decides whether that tool is allowed to run immediately or must wait
// for an explicit user confirmation first.

export type RiskLevel = 'low' | 'medium' | 'high';

export const RISK_TIERS: Record<string, RiskLevel> = {
  // LOW — safe, non-destructive, easily reversible
  open_application: 'low',
  focus_window: 'low',
  list_windows: 'low',
  minimize_window: 'low',
  restore_window: 'low',
  search_files: 'low',
  take_screenshot: 'low',
  read_clipboard: 'low',
  write_clipboard: 'low',
  get_system_info: 'low',
  list_processes: 'low',
  media_control: 'low',
  media_key: 'low',
  open_browser: 'low',
  navigate_browser: 'low',
  search_web: 'low',
  search_youtube: 'low',
  open_spotify: 'low',
  open_whatsapp: 'low',
  open_telegram: 'low',
  open_windows_settings: 'low',
  get_monitors: 'low',
  list_macros: 'low',
  cancel_shutdown: 'low',
  run_safe_command: 'low',
  open_in_vscode: 'low',
  open_whatsapp_chat_window: 'low', // opens/focuses a window; reads nothing by itself
  read_whatsapp_chat: 'low',        // read-only — no state change
  open_telegram_chat_window: 'low',
  read_telegram_chat: 'low',
  read_screen: 'low',               // read-only screenshot + description
  find_ui_element: 'low',           // read-only — returns coordinates, clicks nothing
  get_screen_context: 'low',        // read-only — returns the cached ambient summary, captures nothing new
  extract_screen_text: 'low',       // read-only — same screenshot+vision path as read_screen, just verbatim output
  resolve_contact: 'low',           // read-only lookup
  list_contacts: 'low',             // read-only lookup

  // Browser automation (Pass 10) — Anushka's own DOM-scripted BrowserWindow.
  open_web_page: 'low',      // same tier as open_browser — just shows a page
  read_web_page: 'low',      // read-only DOM text extraction
  find_web_element: 'low',   // read-only — returns an index, clicks nothing
  close_web_page: 'low',

  // Scheduled / timed automation (Pass 11)
  list_scheduled_tasks: 'low', // read-only

  // Android phone control (over ADB)
  list_android_devices: 'low',   // read-only discovery
  android_open_app: 'low',
  android_lock: 'low',           // same as pressing the power button; PIN/pattern still guards it
  android_wake: 'low',           // wakes screen only, cannot bypass a real lock

  // MEDIUM — changes state, but reversible / low blast radius
  close_application: 'medium',
  maximize_window: 'medium',
  move_window: 'medium',
  resize_window: 'medium',
  set_volume: 'medium',
  mute_volume: 'medium',
  set_brightness: 'medium',
  create_file: 'medium',
  create_folder: 'medium',
  rename_file: 'medium',
  copy_file: 'medium',
  move_file: 'medium',
  open_file: 'medium',
  open_folder: 'medium',
  type_text: 'medium',
  press_key: 'medium',
  hotkey: 'medium',
  move_mouse: 'medium',
  click_mouse: 'medium',
  clear_clipboard: 'medium',
  move_window_to_monitor: 'medium',
  prepare_whatsapp_message: 'medium', // pre-fills text; does not send
  prepare_telegram_message: 'medium', // pre-fills text; does not send
  prepare_email_message: 'medium',    // pre-fills text; does not send
  open_system_tool: 'medium',
  create_macro: 'medium',
  delete_macro: 'medium',
  run_automation: 'medium', // the risk tiers of the STEPS still apply individually
  run_macro: 'medium',
  add_contact: 'medium',
  update_contact: 'medium',
  delete_contact: 'medium',
  call_contact: 'medium', // dials via the user's own tel: handler; reversible (hang up), not a message send

  // Browser automation (Pass 10) — changes page state (could submit a form,
  // navigate away, start a purchase). Same tier logic as click_mouse/
  // type_text. NOTE: shipping click_web_element at medium (bypassable in
  // Trusted Mode) is a judgment call, not an obvious answer — a "Buy Now" /
  // "Confirm Order" / "Pay" click carries real financial risk a generic
  // medium tier may undersell. See UPGRADE_NOTES.md Pass 10 for the reasoning
  // and a possible future keyword-escalation heuristic (label matching
  // /buy|pay|purchase|checkout|confirm order/i -> forces high).
  click_web_element: 'medium',
  type_into_web_field: 'medium',

  // Scheduled / timed automation (Pass 11) — sets up / removes a future
  // action; reversible, low blast radius, same tier logic as create_macro/
  // delete_macro. The STEPS a scheduled task will eventually run still get
  // their own individual risk-tier treatment when they actually fire — see
  // electron/main/scheduler.ts.
  create_scheduled_task: 'medium',
  delete_scheduled_task: 'medium',

  connect_android_device: 'medium',
  pair_android_device: 'medium',
  android_set_volume: 'medium',
  android_set_brightness: 'medium',

  // HIGH — destructive or affects the whole machine/session. ALWAYS confirm.
  delete_file: 'high',
  delete_folder: 'high',
  kill_process: 'high',
  lock_computer: 'low', // locking is safe & reversible with normal auth
  sleep_computer: 'high',
  hibernate_computer: 'high',
  restart_computer: 'high',
  shutdown_computer: 'high',
  sign_out: 'high',
  send_prepared_message: 'high', // the actual "press send" for WhatsApp/Telegram/email
};

export function riskOf(tool: string): RiskLevel {
  return RISK_TIERS[tool] ?? 'high'; // unknown tool => treat as high risk
}

// Kept for anything still importing the old boolean check — equivalent to
// checkPermission(tool, args, false) i.e. "would this confirm with Trusted
// Mode OFF". Prefer checkPermission() below for actual execution decisions.
export function requiresConfirmation(tool: string): boolean {
  return riskOf(tool) !== 'low';
}

export type PermissionDecision = 'ALLOW' | 'CONFIRM' | 'DENY';

// The single source of truth for "does this tool call run immediately or
// does the user get asked first". This is what section 1-4 of the upgrade
// spec means by a "centralized policy engine" — executeTool() in
// registry.ts calls this ONCE per tool call instead of scattering ad-hoc
// confirm() checks through the codebase.
//
//   LOW    -> always ALLOW
//   MEDIUM -> ALLOW when Trusted Mode is on, CONFIRM when it's off
//   HIGH   -> always CONFIRM, Trusted Mode has no effect
//
// Tools in ALWAYS_CONFIRM, and recursive deletes, escalate to CONFIRM no
// matter what tier they're nominally in — defense in depth against a
// hallucinated/spoofed "pre-approved" flag from the model layer.
export function checkPermission(tool: string, args: Record<string, any>, trustedMode: boolean): PermissionDecision {
  if (ALWAYS_CONFIRM.has(tool)) return 'CONFIRM';
  if (tool.startsWith('delete_') && isRecursiveDelete(args)) return 'CONFIRM';

  const risk = riskOf(tool);
  if (risk === 'low') return 'ALLOW';
  if (risk === 'high') return 'CONFIRM';
  // medium
  return trustedMode ? 'ALLOW' : 'CONFIRM';
}

// Tools that must ALWAYS be confirmed even if a caller tries to mark the
// request as "pre-approved" — defense in depth against a hallucinated or
// spoofed confirmation flag from the model layer.
export const ALWAYS_CONFIRM = new Set([
  'shutdown_computer',
  'restart_computer',
  'sign_out',
  'sleep_computer',
  'hibernate_computer',
  'delete_file',
  'delete_folder',
  'kill_process',
  'send_prepared_message',
]);

// Recursive/bulk deletion is a distinct, stricter flag checked by the file
// tools handler in addition to the risk tier above.
export function isRecursiveDelete(args: Record<string, any>): boolean {
  return Boolean(args?.recursive);
}
