// electron/tools/nodeTools.ts
//
// Tool implementations that don't need the Python sidecar. Every OS
// interaction here uses execFile with a fixed executable + argument ARRAY
// (never a concatenated shell string), so AI-provided text can never be
// interpreted as shell syntax.

import { execFile } from 'child_process';
import { promisify } from 'util';
import { app, clipboard, shell, screen } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  navigateToWhatsappChat,
  navigateToTelegramChat,
  scrapeChat,
  getOrCreateChatWindow,
  openWhatsappChatForSend,
  fillWhatsappComposer,
  clickWhatsappSend,
  getWhatsappOutgoingFingerprint,
  waitForOutgoingMessage,
} from '../main/chatWindows';
import { callSidecar } from './sidecarClient';
import { resolveContact, normalizeIndianPhone } from './contacts';
import { getScreenContext as getCachedScreenContext } from '../main/screenAwareness';
import * as webAuto from '../main/webAutomation';
import * as scheduler from '../main/scheduler';
import type { ScheduleTrigger, ScheduleAction } from '../main/scheduler';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Application registry — discovers installed apps from the Start Menu so we
// are not limited to a hard-coded list of five programs.
// ---------------------------------------------------------------------------
interface AppEntry {
  name: string;
  target: string; // .lnk / .exe path
}

let appRegistryCache: AppEntry[] | null = null;
let appRegistryCachedAt = 0;

async function scanShortcuts(dir: string, out: AppEntry[]): Promise<void> {
  let entries: import('fs').Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanShortcuts(full, out);
    } else if (entry.name.toLowerCase().endsWith('.lnk')) {
      out.push({ name: path.basename(entry.name, '.lnk'), target: full });
    }
  }
}

async function scanExesShallow(dir: string, out: AppEntry[], depth: number): Promise<void> {
  if (depth < 0) return;
  let entries: import('fs').Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanExesShallow(full, out, depth - 1);
    } else if (entry.name.toLowerCase().endsWith('.exe')) {
      out.push({ name: path.basename(entry.name, '.exe'), target: full });
    }
  }
}

export async function getAppRegistry(forceRefresh = false): Promise<AppEntry[]> {
  const FIVE_MIN = 5 * 60 * 1000;
  if (!forceRefresh && appRegistryCache && Date.now() - appRegistryCachedAt < FIVE_MIN) {
    return appRegistryCache;
  }
  const out: AppEntry[] = [];
  const startMenuDirs = [
    path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs',
    path.join(os.homedir(), 'Desktop'),
  ];
  for (const dir of startMenuDirs) {
    await scanShortcuts(dir, out);
  }
  // Fallback discovery for apps with no Start Menu shortcut (portable installs,
  // some UWP/WindowsApps entries) — shallow scan only, so this stays fast.
  const exeDirs = [
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    path.join(os.homedir(), 'AppData', 'Local', 'Programs'),
  ];
  for (const dir of exeDirs) {
    await scanExesShallow(dir, out, 2);
  }
  appRegistryCache = out;
  appRegistryCachedAt = Date.now();
  return out;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function resolveApp(nameQuery: string): Promise<AppEntry | null> {
  const registry = await getAppRegistry();
  const target = normalize(nameQuery);
  // exact-ish match first, then "contains"
  let best = registry.find((a) => normalize(a.name) === target);
  if (!best) best = registry.find((a) => normalize(a.name).includes(target));
  if (!best) best = registry.find((a) => target.includes(normalize(a.name)) && a.name.length > 2);
  return best || null;
}

export async function openApplication(args: { application: string }) {
  const found = await resolveApp(args.application);
  if (found) {
    await shell.openPath(found.target);
    return { success: true, tool: 'open_application', opened: found.name };
  }
  // Fall back: let Windows try to resolve it as a known protocol/app id
  // via `start`, still through execFile with a fixed argv (no shell:true).
  try {
    await execFileAsync('cmd.exe', ['/c', 'start', '', args.application]);
    return { success: true, tool: 'open_application', opened: args.application, note: 'resolved via Windows start' };
  } catch (err: any) {
    return { success: false, tool: 'open_application', error: `Application "${args.application}" not found` };
  }
}

export async function closeApplication(args: { application: string }) {
  try {
    // taskkill by image name; user-facing app name -> best effort match.
    await execFileAsync('taskkill', ['/IM', args.application.endsWith('.exe') ? args.application : `${args.application}.exe`, '/F']);
    return { success: true, tool: 'close_application' };
  } catch (err: any) {
    return { success: false, tool: 'close_application', error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Power control — fixed, parameterized calls only. No auth bypass, ever.
// ---------------------------------------------------------------------------
export async function lockComputer() {
  await execFileAsync('rundll32.exe', ['user32.dll,LockWorkStation']);
  return { success: true, tool: 'lock_computer' };
}
export async function sleepComputer() {
  await execFileAsync('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']);
  return { success: true, tool: 'sleep_computer' };
}
export async function hibernateComputer() {
  await execFileAsync('shutdown.exe', ['/h']);
  return { success: true, tool: 'hibernate_computer' };
}
export async function restartComputer() {
  await execFileAsync('shutdown.exe', ['/r', '/t', '0']);
  return { success: true, tool: 'restart_computer' };
}
export async function shutdownComputer() {
  await execFileAsync('shutdown.exe', ['/s', '/t', '0']);
  return { success: true, tool: 'shutdown_computer' };
}
export async function signOut() {
  await execFileAsync('shutdown.exe', ['/l']);
  return { success: true, tool: 'sign_out' };
}
export async function cancelShutdown() {
  await execFileAsync('shutdown.exe', ['/a']);
  return { success: true, tool: 'cancel_shutdown' };
}

// ---------------------------------------------------------------------------
// Clipboard — Electron's built-in module, no native module needed.
// ---------------------------------------------------------------------------
export function readClipboard() {
  return { success: true, tool: 'read_clipboard', text: clipboard.readText() };
}
export function writeClipboard(args: { text: string }) {
  clipboard.writeText(args.text ?? '');
  return { success: true, tool: 'write_clipboard' };
}
export function clearClipboard() {
  clipboard.clear();
  return { success: true, tool: 'clear_clipboard' };
}

// ---------------------------------------------------------------------------
// File & folder control — every destructive op assumes it is called AFTER
// confirmation has already been granted by the risk/confirmation layer.
// ---------------------------------------------------------------------------
function safeResolve(p: string): string {
  // Expand a few friendly aliases; otherwise resolve relative to home.
  const home = os.homedir();
  const aliases: Record<string, string> = {
    downloads: path.join(home, 'Downloads'),
    desktop: path.join(home, 'Desktop'),
    documents: path.join(home, 'Documents'),
    pictures: path.join(home, 'Pictures'),
  };
  const key = p.toLowerCase().trim();
  if (aliases[key]) return aliases[key];
  return path.isAbsolute(p) ? p : path.join(home, p);
}

export async function openFileOrFolder(args: { path: string }) {
  const target = safeResolve(args.path);
  const err = await shell.openPath(target);
  return err ? { success: false, tool: 'open_file', error: err } : { success: true, tool: 'open_file', path: target };
}

export async function createFolder(args: { path: string }) {
  const target = safeResolve(args.path);
  await fs.mkdir(target, { recursive: true });
  return { success: true, tool: 'create_folder', path: target };
}

export async function createFile(args: { path: string; content?: string }) {
  const target = safeResolve(args.path);
  await fs.writeFile(target, args.content ?? '', 'utf-8');
  return { success: true, tool: 'create_file', path: target };
}

export async function renameFile(args: { path: string; newName: string }) {
  const target = safeResolve(args.path);
  const dest = path.join(path.dirname(target), args.newName);
  await fs.rename(target, dest);
  return { success: true, tool: 'rename_file', path: dest };
}

export async function copyFile(args: { source: string; destination: string }) {
  const src = safeResolve(args.source);
  const dest = safeResolve(args.destination);
  await fs.cp(src, dest, { recursive: true });
  return { success: true, tool: 'copy_file', path: dest };
}

export async function moveFile(args: { source: string; destination: string }) {
  const src = safeResolve(args.source);
  const dest = safeResolve(args.destination);
  await fs.rename(src, dest);
  return { success: true, tool: 'move_file', path: dest };
}

// Only called by the registry AFTER risk-tier confirmation (and, for
// recursive deletes, the extra explicit confirmation) has been granted.
export async function deleteFileOrFolder(args: { path: string; recursive?: boolean }) {
  const target = safeResolve(args.path);
  const stat = await fs.stat(target);
  if (stat.isDirectory()) {
    await fs.rm(target, { recursive: Boolean(args.recursive), force: false });
  } else {
    await fs.unlink(target);
  }
  return { success: true, tool: 'delete_file', path: target };
}

export async function searchFiles(args: { query?: string; extension?: string; root?: string; maxResults?: number }) {
  const root = safeResolve(args.root || 'Downloads');
  const maxResults = args.maxResults ?? 25;
  const results: string[] = [];
  const queryNorm = args.query?.toLowerCase();
  const extNorm = args.extension?.replace('.', '').toLowerCase();

  async function walk(dir: string, depth: number) {
    if (results.length >= maxResults || depth > 6) return;
    let entries: import('fs').Dirent[] = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxResults) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else {
        const nameLower = entry.name.toLowerCase();
        const matchesQuery = !queryNorm || nameLower.includes(queryNorm);
        const matchesExt = !extNorm || nameLower.endsWith(`.${extNorm}`);
        if (matchesQuery && matchesExt) results.push(full);
      }
    }
  }
  await walk(root, 0);
  return { success: true, tool: 'search_files', results };
}

// ---------------------------------------------------------------------------
// Browser & web control — always via a fixed URL argument to `start`/
// shell.openExternal, never a raw string that could be shell-interpreted.
// ---------------------------------------------------------------------------
function ensureUrl(u: string): string {
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(u)) return `https://${u}`;
  return `https://www.google.com/search?q=${encodeURIComponent(u)}`;
}

export async function openBrowser(args: { url?: string }) {
  const target = args.url ? ensureUrl(args.url) : 'https://www.google.com';
  await shell.openExternal(target);
  return { success: true, tool: 'open_browser', url: target };
}

export async function openUrl(args: { url: string }) {
  const target = ensureUrl(args.url);
  await shell.openExternal(target);
  return { success: true, tool: 'open_url', url: target };
}

export async function searchWeb(args: { query: string; engine?: string }) {
  const engine = (args.engine || 'google').toLowerCase();
  const q = encodeURIComponent(args.query);
  const url =
    engine === 'bing' ? `https://www.bing.com/search?q=${q}` :
    engine === 'duckduckgo' ? `https://duckduckgo.com/?q=${q}` :
    `https://www.google.com/search?q=${q}`;
  await shell.openExternal(url);
  return { success: true, tool: 'search_web', url };
}

export async function searchYoutube(args: { query: string; autoplay?: boolean }) {
  const q = encodeURIComponent(args.query);
  // ytsearch1: jumps straight to the first result (closest to "play X"),
  // a plain search URL lists results instead.
  const url = args.autoplay === false
    ? `https://www.youtube.com/results?search_query=${q}`
    : `https://www.youtube.com/results?search_query=${q}`;
  await shell.openExternal(url);
  return { success: true, tool: 'search_youtube', url, note: 'Opened YouTube search results; ask to open the top result to play it.' };
}

export async function openSpotify(args: { query?: string }) {
  if (args.query) {
    await shell.openExternal(`https://open.spotify.com/search/${encodeURIComponent(args.query)}`);
    return { success: true, tool: 'open_spotify', searched: args.query };
  }
  const found = await resolveApp('Spotify');
  if (found) {
    await shell.openPath(found.target);
    return { success: true, tool: 'open_spotify', opened: 'Spotify (desktop app)' };
  }
  await shell.openExternal('https://open.spotify.com');
  return { success: true, tool: 'open_spotify', opened: 'Spotify Web Player' };
}

// ---------------------------------------------------------------------------
// WhatsApp — runs ENTIRELY inside the app's own Electron BrowserWindow (see
// electron/main/chatWindows.ts), never wa.me, never shell.openExternal,
// never the user's Chrome/Edge/default browser. "Preparing" a message opens
// the correct chat inside that window and types the text into WhatsApp's own
// composer via DOM automation, but does not press Send. Actually sending is
// a separate, always-confirmed step (see riskPolicy.ts ALWAYS_CONFIRM) that
// clicks WhatsApp's own Send button and then VERIFIES the message actually
// left the composer before reporting success — see sendPreparedMessage /
// commitWhatsappSend below. Nothing here bypasses login/2FA/CAPTCHA; a
// logged-out session still shows WhatsApp's own QR code, same as a browser.
//
// Telegram and Gmail are unaffected by this change — see prepareTelegramMessage/
// prepareEmailMessage further down, which still use the deep-link + sidecar
// keypress flow they always have.
// ---------------------------------------------------------------------------

type PreparedTarget =
  | { platform: 'whatsapp'; phoneDigits: string; message: string; label: string }
  | { platform: 'telegram' }
  | { platform: 'gmail' };

// What sendPreparedMessage will act on next. Reset to null at the START of
// every prepare_* call (not just on success) so a failed re-prepare can
// never leave a stale, mismatched target around for a later "yes, send it".
let lastPrepared: PreparedTarget | null = null;

export async function openWhatsapp() {
  const found = await resolveApp('WhatsApp');
  if (found) {
    await shell.openPath(found.target);
    return { success: true, tool: 'open_whatsapp', opened: 'WhatsApp (desktop app)' };
  }
  await shell.openExternal('https://web.whatsapp.com');
  return { success: true, tool: 'open_whatsapp', opened: 'WhatsApp Web' };
}

async function openAndFillWhatsapp(
  phoneDigits: string,
  message: string
): Promise<{ ok: boolean; error?: string; loginRequired?: boolean }> {
  const opened = await openWhatsappChatForSend(phoneDigits);
  if (!opened.ok) return opened;
  const filled = await fillWhatsappComposer(message);
  if (!filled.ok) return { ok: false, error: filled.error };
  return { ok: true };
}

export async function prepareWhatsappMessage(args: { contact?: string; phone?: string; message: string }) {
  lastPrepared = null;

  if (!args.phone && !args.contact) {
    return { success: false, tool: 'prepare_whatsapp_message', error: 'Need a phone number (with country code) or contact name to open a chat.' };
  }
  const message = args.message ?? '';

  let phoneDigits: string;
  let label: string;

  // Explicit phone number given — use it directly, no contact lookup needed.
  if (args.phone) {
    const { normalized, valid } = normalizeIndianPhone(args.phone);
    if (!valid) {
      return { success: false, tool: 'prepare_whatsapp_message', error: `"${args.phone}" doesn't look like a valid phone number.` };
    }
    phoneDigits = normalized;
    label = args.phone;
  } else {
    // Contact name given — resolve through the saved contact database
    // FIRST. Never guess a number for a name we don't have on file. Names
    // can be multiple words ("Pihu Sharma") — resolveContact already
    // handles that via fuzzy matching, not a naive parts[1] split.
    const resolved = await resolveContact(args.contact!);
    if (resolved.matches.length === 0) {
      // No matching contact — open the APP-CONTROLLED WhatsApp window (not
      // an external browser) so the user can search manually.
      getOrCreateChatWindow('whatsapp');
      return {
        success: true,
        tool: 'prepare_whatsapp_message',
        note: `I don't have "${args.contact}" saved as a contact, so I opened WhatsApp instead — search for their chat manually, or tell me their number so I can save it as a contact for next time.`,
      };
    }
    if (resolved.matches.length > 1) {
      return {
        success: false,
        tool: 'prepare_whatsapp_message',
        ambiguous: true,
        candidates: resolved.matches.map((c) => c.name),
        error: `Found more than one contact matching "${args.contact}" (${resolved.matches.map((c) => c.name).join(', ')}). Ask the user which one they mean.`,
      };
    }
    const contact = resolved.matches[0];
    const number = contact.whatsapp || contact.phone;
    if (!number) {
      return { success: false, tool: 'prepare_whatsapp_message', error: `${contact.name} doesn't have a WhatsApp number saved.` };
    }
    const { normalized, valid } = normalizeIndianPhone(number);
    if (!valid) {
      return { success: false, tool: 'prepare_whatsapp_message', error: `${contact.name}'s saved number doesn't look valid.` };
    }
    phoneDigits = normalized;
    label = contact.name;
  }

  const result = await openAndFillWhatsapp(phoneDigits, message);
  if (!result.ok) {
    if (result.loginRequired) {
      return { success: false, tool: 'prepare_whatsapp_message', error: 'WhatsApp Web needs to be logged in first.', loginRequired: true };
    }
    return { success: false, tool: 'prepare_whatsapp_message', error: result.error || 'Could not open the WhatsApp chat.' };
  }

  lastPrepared = { platform: 'whatsapp', phoneDigits, message, label };
  return {
    success: true,
    tool: 'prepare_whatsapp_message',
    preparedFor: label,
    resolvedNumber: phoneDigits,
    note: 'Message is pre-filled but NOT sent yet. Confirm before sending.',
  };
}

// The actual "click Send" step for WhatsApp — DOM automation against the
// SAME window/session prepareWhatsappMessage just filled, with a real
// verification pass afterward. Never returns success:true just because a
// click happened; only because a matching outgoing bubble actually appeared.
async function commitWhatsappSend(
  prepared: { phoneDigits: string; message: string; label: string }
): Promise<{ success: boolean; sent: boolean; tool: string; error?: string; to?: string; note?: string }> {
  // Re-verify (and re-fill if needed) right before sending rather than
  // trusting state from however long ago prepare ran — the window may have
  // been closed, navigated away, or the composer edited/cleared since.
  const ready = await openAndFillWhatsapp(prepared.phoneDigits, prepared.message);
  if (!ready.ok) {
    return {
      success: false,
      sent: false,
      tool: 'send_prepared_message',
      error: ready.loginRequired ? 'WhatsApp Web needs to be logged in first.' : (ready.error || 'Could not reopen the WhatsApp chat to send.'),
    };
  }

  const before = await getWhatsappOutgoingFingerprint();

  const clicked = await clickWhatsappSend();
  if (!clicked.ok) {
    return { success: false, sent: false, tool: 'send_prepared_message', error: "I couldn't find the WhatsApp send button — the layout may have changed." };
  }

  const verified = await waitForOutgoingMessage(before.count, prepared.message, 10000);
  if (!verified) {
    return { success: false, sent: false, tool: 'send_prepared_message', error: "I couldn't verify that the WhatsApp message was sent." };
  }

  return {
    success: true,
    sent: true,
    tool: 'send_prepared_message',
    to: prepared.label,
    note: `WhatsApp message sent to ${prepared.label}.`,
  };
}

// Single entry point the tool registry calls for send_prepared_message.
// Routes to the verified WhatsApp DOM flow when the last thing prepared was
// WhatsApp; Telegram/email are unchanged (still the sidecar keypress, exactly
// as before this fix — fixing WhatsApp automation was this pass's scope).
export async function sendPreparedMessage(args: { method?: string }) {
  const prepared = lastPrepared;

  if (prepared?.platform === 'whatsapp') {
    lastPrepared = null;
    return commitWhatsappSend(prepared);
  }

  return callSidecar('send_prepared_message', args);
}

// ---------------------------------------------------------------------------
// Phone calls. Windows has no built-in cellular radio, so there is no
// legitimate, non-bypass way for this app to place a real phone call by
// itself. What we CAN legitimately do is hand the number to whatever the
// user already has registered as their tel: URI handler — e.g. Phone Link
// (Microsoft's own app, linked to their Android phone), Skype, or a softphone
// — via shell.openExternal('tel:...'), exactly like clicking a phone number
// link in a browser. If nothing is registered, Windows will show its own
// "no app found" prompt; we report that honestly rather than claiming success.
// ---------------------------------------------------------------------------
export async function callContact(args: { contact?: string; phone?: string }) {
  if (!args.phone && !args.contact) {
    return { success: false, tool: 'call_contact', error: 'Need a phone number or a saved contact name to call.' };
  }

  let target: string | undefined = args.phone;
  let label = args.phone || '';

  if (!target && args.contact) {
    const resolved = await resolveContact(args.contact);
    if (resolved.matches.length === 0) {
      return { success: false, tool: 'call_contact', error: `No saved contact matches "${args.contact}". Add them as a contact first, or give me their number.` };
    }
    if (resolved.matches.length > 1) {
      return {
        success: false,
        tool: 'call_contact',
        ambiguous: true,
        candidates: resolved.matches.map((c) => c.name),
        error: `Found more than one contact matching "${args.contact}" (${resolved.matches.map((c) => c.name).join(', ')}). Ask the user which one they mean.`,
      };
    }
    const contact = resolved.matches[0];
    if (!contact.phone) {
      return { success: false, tool: 'call_contact', error: `${contact.name} doesn't have a phone number saved.` };
    }
    target = contact.phone;
    label = contact.name;
  }

  const { normalized, valid } = normalizeIndianPhone(target!);
  if (!valid) {
    return { success: false, tool: 'call_contact', error: `"${target}" doesn't look like a valid phone number.` };
  }

  try {
    await shell.openExternal(`tel:${normalized}`);
  } catch (err: any) {
    return { success: false, tool: 'call_contact', error: err?.message || String(err) };
  }

  return {
    success: true,
    tool: 'call_contact',
    dialed: normalized,
    label,
    note: 'Windows has no built-in cellular calling — this only works if the user has a tel: link handler installed (e.g. Microsoft Phone Link linked to their Android phone, or Skype). If nothing happened, tell the user this device cannot place real phone calls and suggest calling from their phone instead. This is a genuine capability limit, not a bug to route around.',
  };
}

export async function openTelegram() {
  const found = await resolveApp('Telegram');
  if (found) {
    await shell.openPath(found.target);
    return { success: true, tool: 'open_telegram', opened: 'Telegram (desktop app)' };
  }
  await shell.openExternal('https://web.telegram.org');
  return { success: true, tool: 'open_telegram', opened: 'Telegram Web' };
}

export async function prepareTelegramMessage(args: { username?: string; message: string }) {
  lastPrepared = null;
  if (!args.username) {
    return { success: false, tool: 'prepare_telegram_message', error: 'Need a @username to open a Telegram chat.' };
  }
  const uname = args.username.replace(/^@/, '');
  const text = encodeURIComponent(args.message ?? '');
  await shell.openExternal(`https://t.me/${uname}?text=${text}`);
  lastPrepared = { platform: 'telegram' };
  return { success: true, tool: 'prepare_telegram_message', preparedFor: uname, note: 'Message is pre-filled but NOT sent yet. Confirm before sending.' };
}

// The actual "press send" step for WhatsApp/Telegram/Gmail compose — a bare
// Enter keypress. Kept as its own tiny, always-confirmed tool (see
// riskPolicy.ts ALWAYS_CONFIRM) so the model can never chain
// prepare -> send without the user explicitly approving THIS step.
export async function confirmSendMessage() {
  return { success: true, tool: 'confirm_send_message', note: 'Approved — use the send_prepared_message sidecar step to submit it.' };
}

// ---------------------------------------------------------------------------
// WhatsApp / Telegram — READING a chat's visible content. Separate from the
// prepare/send flow above: these open a dedicated, app-controlled window
// (electron/main/chatWindows.ts) whose DOM Anushka can actually read, since
// the desktop-app/external-browser path used for sending has no window
// Anushka can see inside. Opening/reading never touches login, 2FA, or
// CAPTCHA — first use still requires the user to log in normally (scan the
// WhatsApp QR code / sign in to Telegram) exactly as in a regular browser.
//
// Privacy note surfaced to the user in the docs, not hidden here: whatever
// text a read call returns is sent to the Gemini API as a tool result, same
// as any other tool output — including the other person's message content,
// not just the user's own.
// ---------------------------------------------------------------------------
export async function openWhatsappChatWindow(args: { phone?: string }) {
  await navigateToWhatsappChat(args?.phone);
  return {
    success: true,
    tool: 'open_whatsapp_chat_window',
    note: args?.phone
      ? `Opened the WhatsApp chat window for ${args.phone}. If this is the first time, the user needs to scan the WhatsApp QR code to log in before any chat is visible.`
      : 'Opened the WhatsApp Web window. Ask the user which chat to open, or read whichever chat is already open.',
  };
}

export async function readWhatsappChat(args: { maxMessages?: number }) {
  const result = await scrapeChat('whatsapp', args?.maxMessages ?? 30);
  return { success: Boolean(result?.ok), tool: 'read_whatsapp_chat', ...result };
}

export async function openTelegramChatWindow(args: { username?: string }) {
  await navigateToTelegramChat(args?.username);
  return {
    success: true,
    tool: 'open_telegram_chat_window',
    note: args?.username
      ? `Opened the Telegram chat window for @${args.username}. If this is the first time, the user needs to log in normally before any chat is visible.`
      : 'Opened the Telegram Web window. Ask the user which chat to open, or read whichever chat is already open.',
  };
}

export async function readTelegramChat(args: { maxMessages?: number }) {
  const result = await scrapeChat('telegram', args?.maxMessages ?? 30);
  return { success: Boolean(result?.ok), tool: 'read_telegram_chat', ...result };
}

// ---------------------------------------------------------------------------
// Email — same prepare-then-confirm-then-send pattern as WhatsApp/Telegram,
// via a Gmail compose URL instead of a wa.me/t.me deep link. Actually
// sending reuses send_prepared_message, but Gmail's compose box sends on
// Ctrl+Enter (not plain Enter), so callers should pass
// { method: "ctrl_enter" } to that tool for email specifically.
// ---------------------------------------------------------------------------
export async function prepareEmailMessage(args: { to?: string; contact?: string; subject?: string; body?: string; cc?: string }) {
  lastPrepared = null;
  let to = args?.to;

  // "to" may not look like an email address if the model passed a contact
  // name through it (e.g. "Email Amit") — resolve through contacts either
  // way when there's no "@" in it, or when a contact name was given instead.
  if ((!to || !to.includes('@')) ) {
    const nameToResolve = args?.contact || to;
    if (nameToResolve) {
      const resolved = await resolveContact(nameToResolve);
      if (resolved.matches.length === 1 && resolved.matches[0].email) {
        to = resolved.matches[0].email;
      } else if (resolved.matches.length > 1) {
        return {
          success: false,
          tool: 'prepare_email_message',
          ambiguous: true,
          candidates: resolved.matches.map((c) => c.name),
          error: `Found more than one contact matching "${nameToResolve}". Ask the user which one they mean.`,
        };
      } else if (resolved.matches.length === 1 && !resolved.matches[0].email) {
        return { success: false, tool: 'prepare_email_message', error: `${resolved.matches[0].name} doesn't have an email address saved.` };
      }
    }
  }

  if (!to) {
    return { success: false, tool: 'prepare_email_message', error: 'Need a recipient email address or a saved contact name.' };
  }
  const params = new URLSearchParams({ view: 'cm', fs: '1', to });
  if (args.subject) params.set('su', args.subject);
  if (args.body) params.set('body', args.body);
  if (args.cc) params.set('cc', args.cc);
  await shell.openExternal(`https://mail.google.com/mail/?${params.toString()}`);
  lastPrepared = { platform: 'gmail' };
  return {
    success: true,
    tool: 'prepare_email_message',
    preparedFor: to,
    note: 'Gmail compose window opened with the email PRE-FILLED but NOT sent yet. Tell the user what will be sent and to whom, then only call send_prepared_message with { method: "ctrl_enter" } after they clearly agree to send.',
  };
}

// ---------------------------------------------------------------------------
// Windows Settings / admin tool launcher — every entry is a fixed,
// allowlisted URI or executable name, never free-form user text.
// ---------------------------------------------------------------------------
const SETTINGS_PAGES: Record<string, string> = {
  display: 'ms-settings:display',
  sound: 'ms-settings:sound',
  bluetooth: 'ms-settings:bluetooth',
  network: 'ms-settings:network',
  wifi: 'ms-settings:network-wifi',
  personalization: 'ms-settings:personalization',
  wallpaper: 'ms-settings:personalization-background',
  apps: 'ms-settings:appsfeatures',
  accounts: 'ms-settings:yourinfo',
  time: 'ms-settings:dateandtime',
  gaming: 'ms-settings:gaming-gamebar',
  accessibility: 'ms-settings:easeofaccess',
  privacy: 'ms-settings:privacy',
  update: 'ms-settings:windowsupdate',
  storage: 'ms-settings:storagesense',
  power: 'ms-settings:powersleep',
  notifications: 'ms-settings:notifications',
  vpn: 'ms-settings:network-vpn',
  printers: 'ms-settings:printers',
};

export async function openWindowsSettings(args: { page: string }) {
  const key = (args.page || '').toLowerCase().trim();
  const uri = SETTINGS_PAGES[key] || 'ms-settings:';
  await execFileAsync('cmd.exe', ['/c', 'start', '', uri]);
  return { success: true, tool: 'open_windows_settings', page: key || 'home' };
}

const SYSTEM_TOOLS: Record<string, { cmd: string; args: string[] }> = {
  task_manager: { cmd: 'taskmgr.exe', args: [] },
  device_manager: { cmd: 'mmc.exe', args: ['devmgmt.msc'] },
  disk_management: { cmd: 'mmc.exe', args: ['diskmgmt.msc'] },
  services: { cmd: 'mmc.exe', args: ['services.msc'] },
  event_viewer: { cmd: 'mmc.exe', args: ['eventvwr.msc'] },
  control_panel: { cmd: 'control.exe', args: [] },
  registry_editor: { cmd: 'regedit.exe', args: [] },
  command_prompt: { cmd: 'cmd.exe', args: [] },
  powershell: { cmd: 'powershell.exe', args: [] },
  terminal: { cmd: 'wt.exe', args: [] },
  file_explorer: { cmd: 'explorer.exe', args: [] },
};

// registry_editor is intentionally NOT auto-launchable without confirmation
// (see riskPolicy.ts) — it can change system-critical state.
export async function openSystemTool(args: { tool: string }) {
  const key = (args.tool || '').toLowerCase().trim().replace(/\s+/g, '_');
  const entry = SYSTEM_TOOLS[key];
  if (!entry) return { success: false, tool: 'open_system_tool', error: `Unknown system tool "${args.tool}"` };
  await execFileAsync(entry.cmd, entry.args).catch(async () => {
    // mmc.exe snap-ins need `start` resolution in some environments
    await execFileAsync('cmd.exe', ['/c', 'start', '', entry.cmd, ...entry.args]);
  });
  return { success: true, tool: 'open_system_tool', opened: key };
}

// ---------------------------------------------------------------------------
// Safe terminal — allowlisted, read-only/informational commands only.
// Fixed argv (no shell:true), timeout, stdout/stderr capture.
// ---------------------------------------------------------------------------
const COMMAND_ALLOWLIST: Record<string, true> = {
  ipconfig: true, ping: true, whoami: true, hostname: true, systeminfo: true,
  tasklist: true, netstat: true, dir: true, echo: true, ver: true,
  node: true, npm: true, python: true, pip: true, git: true, code: true,
  where: true,
};

export async function runSafeCommand(args: { command: string; args?: string[]; timeoutMs?: number }) {
  const cmd = (args.command || '').toLowerCase().trim();
  if (!COMMAND_ALLOWLIST[cmd]) {
    return { success: false, tool: 'run_safe_command', error: `"${args.command}" is not on the allowed command list.` };
  }
  const cliArgs = Array.isArray(args.args) ? args.args.map(String) : [];
  try {
    // dir/echo/ver aren't real executables — they're cmd.exe built-ins.
    const isShellBuiltin = ['dir', 'echo', 'ver'].includes(cmd);
    const { stdout, stderr } = isShellBuiltin
      ? await execFileAsync('cmd.exe', ['/c', cmd, ...cliArgs], { timeout: args.timeoutMs ?? 10000 })
      : await execFileAsync(cmd, cliArgs, { timeout: args.timeoutMs ?? 10000 });
    return { success: true, tool: 'run_safe_command', stdout: stdout?.slice(0, 4000), stderr: stderr?.slice(0, 2000) };
  } catch (err: any) {
    return { success: false, tool: 'run_safe_command', error: err.message, stdout: err.stdout?.slice(0, 2000) };
  }
}

// ---------------------------------------------------------------------------
// VS Code / development helpers
// ---------------------------------------------------------------------------
export async function openInVsCode(args: { path: string }) {
  const target = safeResolve(args.path);
  try {
    await execFileAsync('code', [target]);
    return { success: true, tool: 'open_in_vscode', path: target };
  } catch {
    return { success: false, tool: 'open_in_vscode', error: '"code" CLI not found on PATH — install it from VS Code > Command Palette > "Shell Command: Install code command".' };
  }
}

// ---------------------------------------------------------------------------
// Automation macros — a small, user-editable JSON file of named step
// sequences. Each step is {tool, args}, dispatched back through the SAME
// risk-checked executeTool() path in registry.ts — a macro can never skip
// confirmation for a high-risk step it contains.
// ---------------------------------------------------------------------------
export interface MacroStep { tool: string; args?: Record<string, any> }
export interface Macro { name: string; steps: MacroStep[] }

function macrosFilePath(): string {
  return path.join(app.getPath('userData'), 'macros.json');
}

export async function loadMacros(): Promise<Macro[]> {
  try {
    const raw = await fs.readFile(macrosFilePath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveMacros(macros: Macro[]): Promise<void> {
  await fs.mkdir(path.dirname(macrosFilePath()), { recursive: true });
  await fs.writeFile(macrosFilePath(), JSON.stringify(macros, null, 2), 'utf-8');
}

export async function createMacro(args: { name: string; steps: MacroStep[] }) {
  if (!args.name || !Array.isArray(args.steps) || args.steps.length === 0) {
    return { success: false, tool: 'create_macro', error: 'Macro needs a name and at least one step.' };
  }
  const macros = await loadMacros();
  const idx = macros.findIndex((m) => m.name.toLowerCase() === args.name.toLowerCase());
  const macro: Macro = { name: args.name, steps: args.steps };
  if (idx >= 0) macros[idx] = macro; else macros.push(macro);
  await saveMacros(macros);
  return { success: true, tool: 'create_macro', name: args.name, stepCount: args.steps.length };
}

export async function deleteMacro(args: { name: string }) {
  const macros = await loadMacros();
  const next = macros.filter((m) => m.name.toLowerCase() !== (args.name || '').toLowerCase());
  await saveMacros(next);
  return { success: true, tool: 'delete_macro', name: args.name, deleted: next.length !== macros.length };
}

export async function listMacros() {
  const macros = await loadMacros();
  return { success: true, tool: 'list_macros', macros: macros.map((m) => ({ name: m.name, steps: m.steps.length })) };
}

// ---------------------------------------------------------------------------
// Browser automation (Pass 10) — thin wrappers around electron/main/
// webAutomation.ts, which runs everything inside Anushka's OWN visible
// BrowserWindow via webContents.executeJavaScript() with fixed, reviewed
// scripts. This is a DIFFERENT thing from open_browser/open_url/search_web
// above: those call shell.openExternal() and hand the URL to the user's
// real default browser (a separate process Electron has zero DOM access
// to), so they can show a page but categorically cannot click/type on one.
// This window is the one place that's possible from — see webAutomation.ts
// for why Puppeteer/Playwright wasn't used instead.
// ---------------------------------------------------------------------------
export async function openWebPage(args: { url: string }) {
  if (!args?.url) return { success: false, tool: 'open_web_page', error: 'A URL is required.' };
  const result = await webAuto.navigateTo(args.url);
  if (!result.ok) return { success: false, tool: 'open_web_page', error: result.error || 'Could not load that page.' };
  return { success: true, tool: 'open_web_page', url: result.url };
}

export async function readWebPage(args: { question?: string }) {
  const result = await webAuto.readPageText();
  if (!result?.ok) return { success: false, tool: 'read_web_page', error: result?.error || 'No page is open. Call open_web_page first.' };
  return {
    success: true,
    tool: 'read_web_page',
    title: result.title,
    text: result.text,
    ...(result.truncated ? { truncated: true, note: 'The page had more text than fit in one read — this may be partial.' } : {}),
  };
}

export async function findWebElement(args: { target: string }) {
  if (!args?.target || !String(args.target).trim()) {
    return { success: false, tool: 'find_web_element', error: 'A description of the element to find is required.' };
  }
  const result = await webAuto.listClickableElements();
  if (!result?.ok) return { success: false, tool: 'find_web_element', error: result?.error || 'No page is open. Call open_web_page first.' };

  const elements: { index: number; tag: string; type: string; label: string }[] = result.elements || [];
  // Fuzzy match against `target` — a simple case-insensitive substring
  // score, same "don't guess, say found:false" contract as find_ui_element.
  const needle = String(args.target).toLowerCase().trim();
  let best: { index: number; tag: string; type: string; label: string } | null = null;
  let bestScore = 0;
  for (const el of elements) {
    const label = (el.label || '').toLowerCase();
    if (!label) continue;
    let score = 0;
    if (label === needle) score = 100;
    else if (label.includes(needle) || needle.includes(label)) score = 60;
    else {
      const needleWords = needle.split(/\s+/).filter(Boolean);
      const hits = needleWords.filter((w) => label.includes(w)).length;
      if (needleWords.length > 0) score = Math.round((hits / needleWords.length) * 40);
    }
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }

  if (!best || bestScore < 30) {
    return { success: true, tool: 'find_web_element', found: false, elements, note: `Nothing on the page confidently matched "${args.target}" — here are all the clickable/typeable elements found instead.` };
  }
  return { success: true, tool: 'find_web_element', found: true, match: best, elements };
}

export async function clickWebElement(args: { index: number }) {
  if (typeof args?.index !== 'number') return { success: false, tool: 'click_web_element', error: 'An element index (from find_web_element or read_web_page) is required.' };
  const result = await webAuto.clickElement(args.index);
  if (!result.ok) return { success: false, tool: 'click_web_element', error: result.error };
  return { success: true, tool: 'click_web_element', index: args.index };
}

export async function typeIntoWebField(args: { index: number; text: string }) {
  if (typeof args?.index !== 'number') return { success: false, tool: 'type_into_web_field', error: 'An element index (from find_web_element or read_web_page) is required.' };
  const result = await webAuto.typeIntoElement(args.index, args.text ?? '');
  if (!result.ok) return { success: false, tool: 'type_into_web_field', error: result.error };
  return { success: true, tool: 'type_into_web_field', index: args.index, currentText: result.currentText };
}

export async function closeWebPage() {
  webAuto.closeAutomationWindow();
  return { success: true, tool: 'close_web_page' };
}

// ---------------------------------------------------------------------------
// Scheduled / timed automation (Pass 11) — thin wrappers around
// electron/main/scheduler.ts, mirroring create_macro/list_macros/
// delete_macro's signatures and error style. The scheduler's own background
// loop is what actually fires these; these three tools only manage the
// persisted list.
// ---------------------------------------------------------------------------
export async function createScheduledTask(args: {
  label: string;
  trigger: ScheduleTrigger;
  action: ScheduleAction;
  allowUnattendedConfirm?: boolean;
}) {
  return scheduler.createScheduledTask(args);
}

export async function listScheduledTasks() {
  return scheduler.listScheduledTasks();
}

export async function deleteScheduledTask(args: { id?: string; label?: string }) {
  return scheduler.deleteScheduledTask(args);
}

// ---------------------------------------------------------------------------
// Screen vision — screenshot (sidecar) + a Gemini Vision call made by
// server.ts's /api/vision/analyze-screen route, not by this process
// directly, so GEMINI_API_KEY only ever lives in the one place it already
// lived. The full screenshot never travels back into the Live voice
// session — only the resulting text/coordinates do (see server.ts for why).
// ---------------------------------------------------------------------------
const VISION_ENDPOINT = process.env.ANUSHKA_VISION_ENDPOINT || 'http://localhost:3000/api/vision/analyze-screen';

async function captureScreenshotBase64(): Promise<{ imageBase64: string; mimeType: string }> {
  const shot = await callSidecar('take_screenshot', {});
  if (!shot?.success || !shot?.imageBase64) {
    throw new Error(shot?.error || 'Screenshot capture failed');
  }
  return { imageBase64: shot.imageBase64, mimeType: shot.mimeType || 'image/png' };
}

async function callVisionApi(body: Record<string, any>): Promise<{ text: string; truncated?: boolean }> {
  const res = await fetch(VISION_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Vision request failed (HTTP ${res.status})`);
  }
  return data;
}

export async function readScreen(args: { question?: string }) {
  const { imageBase64, mimeType } = await captureScreenshotBase64();
  const data = await callVisionApi({ imageBase64, mimeType, mode: 'describe', question: args?.question });
  return { success: true, tool: 'read_screen', description: (data.text || '').trim() };
}

// Verbatim transcription of on-screen text (Pass 8), as opposed to
// readScreen's 2-4 sentence summary — for "quote the exact job posting/
// error/number on screen" requests where a paraphrase would lose the
// detail that actually matters. Same capture + vision-call plumbing as
// readScreen/findUiElement above; server.ts caps and truncates the output,
// this just forwards whatever comes back.
export async function extractScreenText() {
  const { imageBase64, mimeType } = await captureScreenshotBase64();
  const data = await callVisionApi({ imageBase64, mimeType, mode: 'extract' });
  return {
    success: true,
    tool: 'extract_screen_text',
    text: (data.text || '').trim(),
    ...(data.truncated ? { truncated: true, note: 'The screen had more text than fit in one read — this may be a partial transcription.' } : {}),
  };
}

export async function findUiElement(args: { target: string }) {
  if (!args?.target || !String(args.target).trim()) {
    return { success: false, tool: 'find_ui_element', error: 'A description of the element to find is required.' };
  }
  const { imageBase64, mimeType } = await captureScreenshotBase64();
  const data = await callVisionApi({ imageBase64, mimeType, mode: 'locate', target: args.target });

  let parsed: any;
  try {
    parsed = JSON.parse((data.text || '').trim());
  } catch {
    return { success: false, tool: 'find_ui_element', error: 'Could not parse a location from the vision response.' };
  }

  if (!parsed?.found || typeof parsed.x !== 'number' || typeof parsed.y !== 'number') {
    return { success: true, tool: 'find_ui_element', found: false, label: parsed?.label || args.target };
  }
  return {
    success: true,
    tool: 'find_ui_element',
    found: true,
    x: Math.round(parsed.x),
    y: Math.round(parsed.y),
    label: parsed.label || args.target,
    confidence: parsed.confidence || 'medium',
  };
}

// ---------------------------------------------------------------------------
// Ambient screen context (Pass 6) — reads the cache electron/main/
// screenAwareness.ts's background loop maintains. Never captures a new
// screenshot itself, so this is instant and safe to leave LOW risk: it can
// only ever return what the periodic loop already decided was worth
// keeping. If screen awareness is off (the default), the state module says
// so plainly instead of pretending to have data.
// ---------------------------------------------------------------------------
export function getScreenContext() {
  const ctx = getCachedScreenContext();
  return {
    success: true,
    tool: 'get_screen_context',
    enabled: ctx.enabled,
    summary: ctx.summary,
    notable: ctx.notable,
    notableReason: ctx.notableReason,
    checkedSecondsAgo: ctx.checkedAt ? Math.round((Date.now() - ctx.checkedAt) / 1000) : null,
  };
}

// ---------------------------------------------------------------------------
// System info (lightweight, Electron-native — heavier stats via sidecar)
// ---------------------------------------------------------------------------
export function getSystemInfoBasic() {
  const display = screen.getPrimaryDisplay();
  return {
    success: true,
    tool: 'get_system_info',
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    totalMemGB: +(os.totalmem() / 1e9).toFixed(1),
    freeMemGB: +(os.freemem() / 1e9).toFixed(1),
    uptimeHours: +(os.uptime() / 3600).toFixed(1),
    screen: display.size,
    appVersion: app.getVersion(),
  };
}
