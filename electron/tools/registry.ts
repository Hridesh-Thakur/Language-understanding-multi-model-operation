// electron/tools/registry.ts
//
// Single entry point for every tool call coming from the renderer (which
// itself only forwards calls the Gemini model made — see
// src/lib/liveSession.ts). This is the ONLY place tool execution happens in
// the main process, so it's the one place we need to audit for safety.

import { randomUUID } from 'crypto';
import { BrowserWindow } from 'electron';
import { checkPermission, riskOf } from '../security/riskPolicy';
import { isTrustedMode } from '../security/settings';
import { logAction } from '../main/logger';
import * as node from './nodeTools';
import * as contacts from './contacts';
import * as android from './androidTools';
import { callSidecar } from './sidecarClient';

// Simple global abort flag for "Anushka stop" — checked between automation
// steps so a multi-step agent run can be halted immediately.
let stopRequested = false;
export function requestEmergencyStop() { stopRequested = true; }
export function clearEmergencyStop() { stopRequested = false; }
export function isStopRequested() { return stopRequested; }

// `any` (not `Record<string, any>`) so individual tool handlers can declare
// their own narrower, more useful parameter types without TS's strict
// function-parameter variance rejecting the assignment below.
type Handler = (args: any) => Promise<any> | any;

// Tools implemented directly in the main process (no sidecar round trip).
const NODE_HANDLERS: Record<string, Handler> = {
  open_application: node.openApplication,
  close_application: node.closeApplication,
  lock_computer: node.lockComputer,
  sleep_computer: node.sleepComputer,
  hibernate_computer: node.hibernateComputer,
  restart_computer: node.restartComputer,
  shutdown_computer: node.shutdownComputer,
  sign_out: node.signOut,
  read_clipboard: node.readClipboard,
  write_clipboard: node.writeClipboard,
  clear_clipboard: node.clearClipboard,
  open_file: node.openFileOrFolder,
  open_folder: node.openFileOrFolder,
  create_folder: node.createFolder,
  create_file: node.createFile,
  rename_file: node.renameFile,
  copy_file: node.copyFile,
  move_file: node.moveFile,
  delete_file: node.deleteFileOrFolder,
  delete_folder: node.deleteFileOrFolder,
  search_files: node.searchFiles,
  get_system_info: node.getSystemInfoBasic,

  // Android phone control (over ADB — see electron/tools/androidTools.ts)
  list_android_devices: android.listAndroidDevices,
  connect_android_device: android.connectAndroidDevice,
  pair_android_device: android.pairAndroidDevice,
  android_open_app: android.androidOpenApp,
  android_lock: android.androidLock,
  android_wake: android.androidWake,
  android_set_volume: android.androidSetVolume,
  android_set_brightness: android.androidSetBrightness,

  // Browser / web / media
  open_browser: node.openBrowser,
  open_url: node.openUrl,
  search_web: node.searchWeb,
  search_youtube: node.searchYoutube,
  open_spotify: node.openSpotify,

  // WhatsApp / Telegram (deep-link prepare, separate confirmed send step)
  open_whatsapp: node.openWhatsapp,
  prepare_whatsapp_message: node.prepareWhatsappMessage,
  open_telegram: node.openTelegram,
  prepare_telegram_message: node.prepareTelegramMessage,

  // WhatsApp / Telegram — reading a chat's visible content (separate,
  // app-controlled window; see electron/main/chatWindows.ts)
  open_whatsapp_chat_window: node.openWhatsappChatWindow,
  read_whatsapp_chat: node.readWhatsappChat,
  open_telegram_chat_window: node.openTelegramChatWindow,
  read_telegram_chat: node.readTelegramChat,

  // Email (Gmail compose, prepare-then-confirm-then-send via send_prepared_message)
  prepare_email_message: node.prepareEmailMessage,

  // The confirmed "press send" step. For WhatsApp this now runs verified DOM
  // automation in-process (see nodeTools.sendPreparedMessage); Telegram/email
  // still fall back to the sidecar keypress exactly as before.
  send_prepared_message: node.sendPreparedMessage,

  // Screen vision (screenshot + Gemini Vision, via server.ts). Locating an
  // element never clicks it — that still goes through move_mouse/click_mouse
  // and their existing confirmation requirement.
  read_screen: node.readScreen,
  find_ui_element: node.findUiElement,
  get_screen_context: node.getScreenContext,
  extract_screen_text: node.extractScreenText,

  // Windows settings / system tool launchers
  open_windows_settings: node.openWindowsSettings,
  open_system_tool: node.openSystemTool,
  cancel_shutdown: node.cancelShutdown,

  // Safe terminal + dev helper
  run_safe_command: node.runSafeCommand,
  open_in_vscode: node.openInVsCode,

  // Macros / automation
  create_macro: node.createMacro,
  delete_macro: node.deleteMacro,
  list_macros: node.listMacros,

  // Browser automation (Pass 10) — Anushka's own DOM-scripted BrowserWindow
  open_web_page: node.openWebPage,
  read_web_page: node.readWebPage,
  find_web_element: node.findWebElement,
  click_web_element: node.clickWebElement,
  type_into_web_field: node.typeIntoWebField,
  close_web_page: node.closeWebPage,

  // Scheduled / timed automation (Pass 11)
  create_scheduled_task: node.createScheduledTask,
  list_scheduled_tasks: node.listScheduledTasks,
  delete_scheduled_task: node.deleteScheduledTask,

  // Contacts
  resolve_contact: contacts.resolveContactTool,
  add_contact: contacts.addContact,
  update_contact: contacts.addContact, // same upsert-by-name handler
  delete_contact: contacts.deleteContact,
  list_contacts: contacts.listContacts,

  // Calling
  call_contact: node.callContact,
};

// Tools that require the Windows-native Python sidecar.
const SIDECAR_TOOLS = new Set([
  'move_mouse', 'click_mouse', 'scroll_mouse', 'type_text', 'press_key', 'hotkey',
  'list_windows', 'focus_window', 'minimize_window', 'maximize_window', 'restore_window',
  'move_window', 'resize_window', 'close_window',
  'take_screenshot', 'set_volume', 'mute_volume', 'set_brightness',
  'list_processes', 'kill_process',
  'get_monitors', 'move_window_to_monitor', 'media_key',
]);

async function dispatch(tool: string, args: Record<string, any>) {
  if (NODE_HANDLERS[tool]) return NODE_HANDLERS[tool](args);
  if (SIDECAR_TOOLS.has(tool)) return callSidecar(tool, args);
  return { success: false, error: `Unknown tool "${tool}"` };
}

// ---------------------------------------------------------------------------
// Confirmation flow — main process asks the renderer to show the existing
// (zero-text, visual) confirmation state, and waits for the user's answer.
// ---------------------------------------------------------------------------
const pendingConfirmations = new Map<string, { resolve: (approved: boolean) => void }>();

export function resolveConfirmation(id: string, approved: boolean) {
  const waiter = pendingConfirmations.get(id);
  if (waiter) {
    pendingConfirmations.delete(id);
    waiter.resolve(approved);
  }
}

function askForConfirmation(win: BrowserWindow, tool: string, args: Record<string, any>): Promise<boolean> {
  const id = randomUUID();
  win.webContents.send('anushka:confirm-request', { id, tool, args, risk: riskOf(tool) });
  return new Promise((resolve) => {
    pendingConfirmations.set(id, { resolve });
    // Auto-deny after 30s of silence — never leave a destructive action
    // hanging on ambiguous/ignored speech.
    setTimeout(() => {
      if (pendingConfirmations.has(id)) {
        pendingConfirmations.delete(id);
        resolve(false);
      }
    }, 30000);
  });
}

export async function executeTool(win: BrowserWindow, tool: string, args: Record<string, any>) {
  if (stopRequested && tool !== 'get_system_info') {
    return { success: false, error: 'Emergency stop is active. Say "Anushka resume" to continue.' };
  }

  // Multi-step automation ("start my work setup", saved macros, or an
  // ad-hoc step list) — each step is re-dispatched through THIS SAME
  // function, so a macro can never skip a high-risk step's confirmation.
  if (tool === 'run_automation' || tool === 'run_macro') {
    return runSteps(win, tool, args);
  }

  // ONE centralized decision per call — see riskPolicy.checkPermission for
  // the LOW/MEDIUM/HIGH + Trusted Mode logic. This replaces the old
  // "confirm almost everything, every time" behavior: in Trusted Mode,
  // normal reversible commands (open app, browse, type, click, volume,
  // move a file, prepare a message, etc.) now return ALLOW and just run.
  const decision = checkPermission(tool, args, isTrustedMode());

  if (decision === 'CONFIRM') {
    const approved = await askForConfirmation(win, tool, args);
    if (!approved) {
      logAction({ tool, args, risk: riskOf(tool), decision, success: false, error: 'User declined confirmation' });
      return { success: false, tool, error: 'User declined confirmation' };
    }
  }

  try {
    const result = await dispatch(tool, args);
    logAction({ tool, args, risk: riskOf(tool), decision, success: result?.success !== false, error: result?.error });
    return result;
  } catch (err: any) {
    const message = err?.message || String(err);
    logAction({ tool, args, risk: riskOf(tool), decision, success: false, error: message });
    return { success: false, tool, error: message };
  }
}

async function runSteps(win: BrowserWindow, tool: string, args: Record<string, any>) {
  let steps: { tool: string; args?: Record<string, any> }[];
  let label = args?.name || 'automation';

  if (tool === 'run_macro') {
    const macros = await node.loadMacros();
    const macro = macros.find((m) => m.name.toLowerCase() === String(args?.name || '').toLowerCase());
    if (!macro) return { success: false, tool, error: `No saved macro named "${args?.name}"` };
    steps = macro.steps;
  } else {
    steps = Array.isArray(args?.steps) ? args.steps : [];
    label = args?.label || 'automation';
  }

  if (steps.length === 0) return { success: false, tool, error: 'No steps to run.' };

  const results: any[] = [];
  for (const step of steps) {
    if (stopRequested) {
      results.push({ tool: step.tool, success: false, error: 'Stopped by emergency stop' });
      break;
    }
    // Recursive call re-enters executeTool, so each step gets its own risk
    // check + confirmation prompt exactly as if the user asked for it alone.
    const r = await executeTool(win, step.tool, step.args ?? {});
    results.push({ tool: step.tool, ...r });
    if (r?.success === false) break; // stop the sequence on first failure, per spec section 27
  }

  const allOk = results.every((r) => r.success !== false);
  return { success: allOk, tool, label, steps: results };
}
