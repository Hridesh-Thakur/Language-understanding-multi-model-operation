// electron/main/chatWindows.ts
//
// On-demand, reusable BrowserWindows for WhatsApp Web / Telegram Web, used
// ONLY so Anushka can read the currently-open chat's visible text. These
// are ordinary Electron windows — contextIsolation on, nodeIntegration off,
// sandboxed, no preload script exposing anything to the page. Reading
// happens via BrowserWindow.webContents.executeJavaScript() called from
// this TRUSTED main-process code; that's Electron's own host-driven API,
// not something exposed to (or requested by) the web page itself.
//
// Login/session state persists across app restarts via a dedicated
// partition per platform, but nothing here touches login, 2FA, or CAPTCHA —
// the first time, the user authenticates exactly as they would in a normal
// browser (scanning the WhatsApp QR code / signing in to Telegram).
//
// Reminder for whoever maintains this: WhatsApp Web and Telegram Web are
// not public APIs — both occasionally change their internal DOM/class
// names, which can silently break the primary selector below. Each scraper
// falls back to a broader "whole panel" text dump if the primary selector
// finds nothing, so reading degrades gracefully instead of failing outright,
// but the fallback text will include more UI chrome than the primary path.

import { BrowserWindow } from 'electron';

export type ChatPlatform = 'whatsapp' | 'telegram';

const windows: Record<ChatPlatform, BrowserWindow | null> = {
  whatsapp: null,
  telegram: null,
};

const PLATFORM_CONFIG: Record<ChatPlatform, { partition: string; baseUrl: string; title: string }> = {
  whatsapp: {
    partition: 'persist:anushka-whatsapp',
    baseUrl: 'https://web.whatsapp.com',
    title: 'Anushka — WhatsApp',
  },
  telegram: {
    // The "k" web client — historically the most scrape-friendly of
    // Telegram's web versions. If a user is on a different Telegram Web
    // version the fallback panel-text path below still covers it.
    partition: 'persist:anushka-telegram',
    baseUrl: 'https://web.telegram.org/k/',
    title: 'Anushka — Telegram',
  },
};

function createChatWindow(platform: ChatPlatform): BrowserWindow {
  const cfg = PLATFORM_CONFIG[platform];
  const win = new BrowserWindow({
    width: 1000,
    height: 720,
    title: cfg.title,
    webPreferences: {
      partition: cfg.partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Fire-and-forget: callers that need a SPECIFIC chat (e.g. the WhatsApp
  // send flow below) immediately navigate again with loadURL(send?phone=...),
  // which aborts this initial load. Without .catch() that shows up as an
  // unhandled promise rejection.
  win.loadURL(cfg.baseUrl).catch(() => {});
  win.on('closed', () => {
    windows[platform] = null;
  });
  return win;
}

export function getOrCreateChatWindow(platform: ChatPlatform): BrowserWindow {
  let win = windows[platform];
  if (!win || win.isDestroyed()) {
    win = createChatWindow(platform);
    windows[platform] = win;
  }
  win.show();
  win.focus();
  return win;
}

export function hasOpenChatWindow(platform: ChatPlatform): boolean {
  const win = windows[platform];
  return Boolean(win && !win.isDestroyed());
}

export async function navigateToWhatsappChat(phone?: string): Promise<void> {
  const win = getOrCreateChatWindow('whatsapp');
  if (phone) {
    const clean = phone.replace(/[^\d+]/g, '').replace(/^\+/, '');
    await win.loadURL(`https://web.whatsapp.com/send?phone=${clean}`);
  }
}

export async function navigateToTelegramChat(username?: string): Promise<void> {
  const win = getOrCreateChatWindow('telegram');
  if (username) {
    const uname = username.replace(/^@/, '');
    await win.loadURL(`https://web.telegram.org/k/#@${uname}`);
  }
}

export function closeChatWindow(platform: ChatPlatform): void {
  const win = windows[platform];
  if (win && !win.isDestroyed()) win.close();
}

// ---------------------------------------------------------------------------
// Scraping — a small, fixed, reviewed script per platform. Never anything
// built from AI-provided text; the model only ever picks a tool name and
// structured args (e.g. maxMessages), same as every other tool.
// ---------------------------------------------------------------------------

const WHATSAPP_SCRAPE_SCRIPT = `
(() => {
  function textOf(el) { return (el.innerText || '').trim(); }
  const seen = new Set();
  const results = [];
  // WhatsApp Web has long marked each message bubble's text with
  // data-pre-plain-text (e.g. "[10:32 AM, 8/9/2026] John Doe: ").
  const nodes = document.querySelectorAll('div.copyable-text');
  for (const el of nodes) {
    const meta = el.getAttribute('data-pre-plain-text') || '';
    const text = textOf(el);
    const key = meta + '|' + text;
    if (text && !seen.has(key)) {
      seen.add(key);
      results.push({ meta, text });
    }
  }
  if (results.length > 0) {
    return { ok: true, strategy: 'copyable-text', messages: results.slice(-__MAX__) };
  }
  const panel = document.querySelector('#main') || document.querySelector('[data-testid="conversation-panel-wrapper"]');
  if (panel) {
    return { ok: true, strategy: 'panel-fallback', raw: textOf(panel).slice(-8000) };
  }
  return { ok: false, error: 'No open WhatsApp chat found (or WhatsApp Web changed its layout) — open a chat first.' };
})()
`;

const TELEGRAM_SCRAPE_SCRIPT = `
(() => {
  function textOf(el) { return (el.innerText || '').trim(); }
  const seen = new Set();
  const results = [];
  const nodes = document.querySelectorAll('.bubble-content, .Message .text-content');
  for (const el of nodes) {
    const text = textOf(el);
    if (text && !seen.has(text)) {
      seen.add(text);
      results.push({ text });
    }
  }
  if (results.length > 0) {
    return { ok: true, strategy: 'bubbles', messages: results.slice(-__MAX__) };
  }
  const panel = document.querySelector('.messages-container') || document.querySelector('.MessageList') || document.querySelector('#column-center');
  if (panel) {
    return { ok: true, strategy: 'panel-fallback', raw: textOf(panel).slice(-8000) };
  }
  return { ok: false, error: 'No open Telegram chat found (or Telegram Web changed its layout) — open a chat first.' };
})()
`;

export async function scrapeChat(platform: ChatPlatform, maxMessages = 30): Promise<any> {
  if (!hasOpenChatWindow(platform)) {
    return { ok: false, error: `No ${platform} window is open yet. Open it first and select a chat.` };
  }
  const win = windows[platform]!;
  const template = platform === 'whatsapp' ? WHATSAPP_SCRAPE_SCRIPT : TELEGRAM_SCRAPE_SCRIPT;
  const script = template.replace('__MAX__', String(Math.max(1, Math.min(200, maxMessages))));
  try {
    return await win.webContents.executeJavaScript(script);
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// WhatsApp SEND automation.
//
// Runs entirely inside the SAME app-controlled WhatsApp Electron window used
// for reading above (persist:anushka-whatsapp — one shared window/session,
// never a second one). Every step is DOM automation via
// webContents.executeJavaScript() against elements located by CSS selector —
// never a blind global OS-level keypress and never fixed mouse coordinates.
// High-level orchestration (contact resolution, the prepare/confirm split,
// the risk-tiered confirmation prompt) lives in nodeTools.ts; this file only
// knows how to drive the WhatsApp Web page itself.
//
// WhatsApp Web's internal DOM/class names are not a public, versioned API
// and do change over time. Every selector below has at least one fallback,
// and every step returns a specific, honest failure reason instead of
// silently guessing — see the note in nodeTools.ts's sendPreparedMessage for
// how those surface to the user. If WhatsApp changes its markup again, the
// state/selector scripts below are the ONLY place that needs updating.
// ---------------------------------------------------------------------------

export type WhatsappPageState =
  | 'composer_ready'
  | 'chat_list_only'
  | 'needs_continue'
  | 'invalid_number'
  | 'qr_required'
  | 'loading';

const WHATSAPP_COMPOSER_FINDER = `
  function q(sel, scope) { return (scope || document).querySelector(sel); }
  function findComposer(scope) {
    if (!scope) return null;
    return q('div[contenteditable="true"][data-tab]', scope)
      || q('div[contenteditable="true"][role="textbox"]', scope)
      || q('div[contenteditable="true"][aria-label]', scope);
  }
`;

const WHATSAPP_STATE_SCRIPT = `
(() => {
  ${WHATSAPP_COMPOSER_FINDER}
  function textOf(el) { return ((el && (el.innerText || el.textContent)) || '').trim(); }

  const footer = document.querySelector('footer');
  const main = document.querySelector('#main') || document.querySelector('[data-testid="conversation-panel-wrapper"]');
  const composer = findComposer(footer) || findComposer(main);
  if (composer) return { state: 'composer_ready' };

  const dialogs = Array.from(document.querySelectorAll('div[role="dialog"], div[data-animate-modal-popup="true"]'));
  const invalid = dialogs.find(el => /invalid|isn.t on whatsapp|not on whatsapp|couldn.t find/i.test(textOf(el)));
  if (invalid) return { state: 'invalid_number', detail: textOf(invalid).slice(0, 200) };

  const continueBtn = Array.from(document.querySelectorAll('div[role="button"], button'))
    .find(el => /continue to chat/i.test(textOf(el)));
  if (continueBtn) return { state: 'needs_continue' };

  const bodyText = textOf(document.body);
  const qrCanvas = document.querySelector('canvas');
  if (qrCanvas && /log into whatsapp|keep your phone connected|scan the qr code/i.test(bodyText)) {
    return { state: 'qr_required' };
  }

  if (document.querySelector('#pane-side') || document.querySelector('[aria-label="Chat list"]')) {
    return { state: 'chat_list_only' };
  }

  return { state: 'loading' };
})()
`;

const WHATSAPP_CLICK_CONTINUE_SCRIPT = `
(() => {
  const btn = Array.from(document.querySelectorAll('div[role="button"], button'))
    .find(el => /continue to chat/i.test((el.innerText || el.textContent || '').trim()));
  if (!btn) return { ok: false };
  btn.click();
  return { ok: true };
})()
`;

const WHATSAPP_INSERT_TEXT_TEMPLATE = `
(() => {
  ${WHATSAPP_COMPOSER_FINDER}
  const footer = document.querySelector('footer');
  const main = document.querySelector('#main') || document.querySelector('[data-testid="conversation-panel-wrapper"]');
  const el = findComposer(footer) || findComposer(main);
  if (!el) return { ok: false, error: 'composer_not_found' };

  el.focus();
  document.execCommand('selectAll', false, undefined);
  document.execCommand('delete', false, undefined);

  const text = __MESSAGE__;
  let inserted = false;
  try { inserted = document.execCommand('insertText', false, text); } catch (e) { inserted = false; }
  if (!inserted) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: text, inputType: 'insertText' }));
  }

  const current = (el.innerText || el.textContent || '').trim();
  return { ok: current.length > 0, currentText: current };
})()
`;

const WHATSAPP_CLICK_SEND_TEMPLATE = `
(() => {
  ${WHATSAPP_COMPOSER_FINDER}
  function q(sel, scope) { return (scope || document).querySelector(sel); }
  const scope = q('footer') || q('#main') || document;

  const iconSelectors = ['span[data-icon="send"]', 'span[data-icon="wds-ic-send-filled"]', 'span[data-icon*="send" i]'];
  let target = null;
  for (const sel of iconSelectors) {
    const icon = q(sel, scope);
    if (icon) { target = icon.closest('button') || icon.closest('div[role="button"]') || icon; break; }
  }
  if (!target) {
    target = q('button[aria-label="Send"]', scope) || q('[aria-label*="Send" i][role="button"]', scope);
  }
  if (target) { target.click(); return { ok: true, via: 'button' }; }

  // Fallback: dispatch a real Enter keydown/keyup AT THE COMPOSER ELEMENT
  // itself — still DOM-scoped to this window, never a global OS keypress,
  // and only used if no send button could be located.
  const composer = findComposer(document.querySelector('footer')) || findComposer(document.querySelector('#main'));
  if (!composer) return { ok: false, error: 'send_button_not_found' };
  const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
  composer.dispatchEvent(new KeyboardEvent('keydown', opts));
  composer.dispatchEvent(new KeyboardEvent('keyup', opts));
  return { ok: true, via: 'enter_fallback' };
})()
`;

const WHATSAPP_OUTGOING_FINGERPRINT_SCRIPT = `
(() => {
  function textOf(el) { return (el.innerText || '').trim(); }
  const nodes = Array.from(document.querySelectorAll('.message-out div.copyable-text, div[class*="message-out"] div.copyable-text'));
  const last = nodes[nodes.length - 1];
  return { count: nodes.length, lastText: last ? textOf(last) : null };
})()
`;

async function runOnWhatsapp(script: string): Promise<any> {
  const win = windows.whatsapp;
  if (!win || win.isDestroyed()) return { ok: false, error: 'whatsapp_window_missing' };
  try {
    return await win.webContents.executeJavaScript(script);
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function waitForWhatsappState(
  wantStates: WhatsappPageState[],
  timeoutMs: number
): Promise<{ state: WhatsappPageState; detail?: string } | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await runOnWhatsapp(WHATSAPP_STATE_SCRIPT);
    if (result?.state === 'needs_continue') {
      // WhatsApp's own "Continue to Chat" interstitial for click-to-chat
      // links — click through it and keep polling, never report this as a
      // failure by itself.
      await runOnWhatsapp(WHATSAPP_CLICK_CONTINUE_SCRIPT);
    } else if (result?.state && wantStates.includes(result.state)) {
      return result;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

// Navigates the shared WhatsApp window to a specific chat via WhatsApp's own
// click-to-chat endpoint — loaded INSIDE our Electron session, never in an
// external browser. This is the one deterministic way to land on the right
// chat without fragile in-page search-box automation.
export async function openWhatsappChatForSend(
  phoneDigits: string
): Promise<{ ok: true } | { ok: false; error: string; loginRequired?: boolean }> {
  const win = getOrCreateChatWindow('whatsapp');
  try {
    await win.loadURL(`https://web.whatsapp.com/send?phone=${phoneDigits}`);
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to load WhatsApp Web.' };
  }

  const result = await waitForWhatsappState(['composer_ready', 'invalid_number', 'qr_required'], 20000);
  if (!result) return { ok: false, error: 'WhatsApp Web took too long to load. Check your internet connection.' };
  if (result.state === 'qr_required') {
    return { ok: false, error: 'WhatsApp Web needs to be logged in first.', loginRequired: true };
  }
  if (result.state === 'invalid_number') {
    return { ok: false, error: result.detail || "That number doesn't appear to be on WhatsApp." };
  }
  return { ok: true };
}

export async function fillWhatsappComposer(message: string): Promise<{ ok: boolean; error?: string }> {
  const script = WHATSAPP_INSERT_TEXT_TEMPLATE.replace('__MESSAGE__', JSON.stringify(message ?? ''));
  const result = await runOnWhatsapp(script);
  if (!result?.ok) return { ok: false, error: result?.error || 'Could not type into the WhatsApp composer.' };
  return { ok: true };
}

export async function getWhatsappOutgoingFingerprint(): Promise<{ count: number; lastText: string | null }> {
  const result = await runOnWhatsapp(WHATSAPP_OUTGOING_FINGERPRINT_SCRIPT);
  return { count: result?.count ?? 0, lastText: result?.lastText ?? null };
}

export async function clickWhatsappSend(): Promise<{ ok: boolean; error?: string }> {
  const result = await runOnWhatsapp(WHATSAPP_CLICK_SEND_TEMPLATE);
  if (!result?.ok) return { ok: false, error: result?.error || 'Could not find the WhatsApp send button.' };
  return { ok: true };
}

// Polls for a NEW outgoing bubble whose text matches what we just sent —
// this is the actual "did it send" check. Clicking Send (or opening a URL)
// is never treated as success by itself.
export async function waitForOutgoingMessage(
  beforeCount: number,
  expectedMessage: string,
  timeoutMs = 10000
): Promise<boolean> {
  const start = Date.now();
  const needle = expectedMessage.trim().slice(0, 60).toLowerCase();
  while (Date.now() - start < timeoutMs) {
    const fp = await getWhatsappOutgoingFingerprint();
    if (fp.count > beforeCount && fp.lastText && (!needle || fp.lastText.toLowerCase().includes(needle))) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
