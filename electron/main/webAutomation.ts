// electron/main/webAutomation.ts
//
// Generalizes the exact pattern electron/main/chatWindows.ts already uses
// for WhatsApp/Telegram Web to ARBITRARY pages: a single, shared, VISIBLE
// Electron BrowserWindow (own partition, contextIsolation on, nodeIntegration
// off, sandboxed, no preload) that this TRUSTED main-process code drives via
// webContents.executeJavaScript() with small, fixed, reviewed scripts —
// never a string built from AI-provided text. The model only ever picks a
// tool name + structured args (a URL, an element index, text to type); it
// never supplies a CSS selector or a script fragment.
//
// Visible on purpose (not headless): the user should be able to watch what
// Anushka does to a page in real time, the same transparency the
// WhatsApp/Telegram windows already give. No CAPTCHA/anti-bot bypass, no
// reuse of the user's real browser cookies/passwords/extensions — this is a
// separate partition, same reasoning as chatWindows.ts.

import { BrowserWindow } from 'electron';

// Same char-budget constant/pattern as Pass 8's extract_screen_text
// (server.ts EXTRACT_TEXT_CHAR_CAP) — no reason to pick a different number
// without cause.
export const PAGE_TEXT_CHAR_CAP = 3000;

// Bounded so a busy page can't return an unusably long list, and so the
// model is always choosing from a small, skimmable menu.
const MAX_CLICKABLE_ELEMENTS = 40;

const PARTITION = 'persist:anushka-browser';
const WINDOW_TITLE = 'Anushka — Web';

let win: BrowserWindow | null = null;

// Reused from nodeTools.ts's ensureUrl() — duplicated here (not imported)
// specifically to avoid a circular import between nodeTools.ts (which will
// import THIS file's functions) and this file. Keep the two in sync if the
// normalization logic changes.
export function ensureUrl(u: string): string {
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(u)) return `https://${u}`;
  return `https://www.google.com/search?q=${encodeURIComponent(u)}`;
}

function createAutomationWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1100,
    height: 760,
    title: WINDOW_TITLE,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  w.on('closed', () => {
    win = null;
  });
  return w;
}

export function getOrCreateAutomationWindow(): BrowserWindow {
  if (!win || win.isDestroyed()) {
    win = createAutomationWindow();
  }
  win.show();
  win.focus();
  return win;
}

export function hasAutomationWindow(): boolean {
  return Boolean(win && !win.isDestroyed());
}

export function closeAutomationWindow(): { success: boolean } {
  if (win && !win.isDestroyed()) win.close();
  win = null;
  return { success: true };
}

export async function navigateTo(url: string): Promise<{ ok: boolean; url: string; error?: string }> {
  const target = ensureUrl(url);
  const w = getOrCreateAutomationWindow();
  try {
    await w.loadURL(target);
    return { ok: true, url: target };
  } catch (err: any) {
    return { ok: false, url: target, error: err?.message || String(err) };
  }
}

export async function goBack(): Promise<{ ok: boolean; error?: string }> {
  if (!win || win.isDestroyed()) return { ok: false, error: 'No automation window is open.' };
  if (!win.webContents.navigationHistory.canGoBack()) return { ok: false, error: 'Nothing to go back to.' };
  win.webContents.navigationHistory.goBack();
  return { ok: true };
}

export async function goForward(): Promise<{ ok: boolean; error?: string }> {
  if (!win || win.isDestroyed()) return { ok: false, error: 'No automation window is open.' };
  if (!win.webContents.navigationHistory.canGoForward()) return { ok: false, error: 'Nothing to go forward to.' };
  win.webContents.navigationHistory.goForward();
  return { ok: true };
}

export async function reload(): Promise<{ ok: boolean; error?: string }> {
  if (!win || win.isDestroyed()) return { ok: false, error: 'No automation window is open.' };
  win.webContents.reload();
  return { ok: true };
}

async function runOnPage(script: string): Promise<any> {
  if (!win || win.isDestroyed()) return { ok: false, error: 'No automation window is open. Call open_web_page first.' };
  try {
    return await win.webContents.executeJavaScript(script);
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// Fixed, reviewed scripts — the only JS that ever runs in the page. Every
// piece of AI-provided data that flows into one of these (an index, text to
// type) is passed as a JSON-encoded literal, never concatenated as code.
// ---------------------------------------------------------------------------

const READ_PAGE_TEXT_SCRIPT = `
(() => {
  // Simple baseline (innerText already skips display:none / hidden text).
  // A Readability-style boilerplate-stripper is a nice-to-have, not required.
  const title = document.title || '';
  const text = (document.body ? document.body.innerText : '') || '';
  return { ok: true, title, text: text.slice(0, __CAP__) , truncated: text.length > __CAP__ };
})()
`;

// Walks the DOM for visible, interactable elements. Returns a bounded list
// of {index, tag, label, type} — the model picks an index from THIS list,
// never a hand-written CSS selector, which is both more reliable (pages
// change constantly) and safer (no arbitrary-selector/JS-injection surface
// from model output).
const LIST_CLICKABLE_SCRIPT = `
(() => {
  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    return r.bottom > 0 && r.right > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight) && r.left < (window.innerWidth || document.documentElement.clientWidth);
  }
  function labelOf(el) {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return placeholder.trim();
    if ('value' in el && el.value && String(el.value).trim()) return String(el.value).trim().slice(0, 80);
    const text = (el.innerText || el.textContent || '').trim();
    if (text) return text.replace(/\\s+/g, ' ').slice(0, 80);
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    return '';
  }
  const selector = 'a, button, input, textarea, select, [role="button"], [onclick]';
  const nodes = Array.from(document.querySelectorAll(selector));
  const out = [];
  for (const el of nodes) {
    if (out.length >= __MAXN__) break;
    if (!visible(el)) continue;
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type') || (tag === 'a' ? 'link' : tag);
    const label = labelOf(el);
    out.push({ index: out.length, tag, type, label });
  }
  return { ok: true, elements: out, count: out.length };
})()
`;

// clickElement / typeIntoElement re-run this exact same extraction and
// re-locate by the same criteria (same selector, same visibility filter,
// same ordering) rather than trusting a stale index from an earlier call —
// the page may have changed between "find" and "act".
function elementLookupScript(index: number): string {
  return `
(() => {
  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    return r.bottom > 0 && r.right > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight) && r.left < (window.innerWidth || document.documentElement.clientWidth);
  }
  const selector = 'a, button, input, textarea, select, [role="button"], [onclick]';
  const nodes = Array.from(document.querySelectorAll(selector)).filter(visible);
  window.__anushkaEl = nodes[${index}] || null;
  return { found: Boolean(window.__anushkaEl), total: nodes.length };
})()
`;
}

const CLICK_LOOKED_UP_ELEMENT_SCRIPT = `
(() => {
  const el = window.__anushkaEl;
  if (!el) return { ok: false, error: 'element_not_found' };
  el.scrollIntoView({ block: 'center' });
  el.click();
  return { ok: true };
})()
`;

function typeIntoLookedUpElementScript(text: string): string {
  return `
(() => {
  const el = window.__anushkaEl;
  if (!el) return { ok: false, error: 'element_not_found' };
  el.scrollIntoView({ block: 'center' });
  el.focus();
  const text = ${JSON.stringify(text ?? '')};

  // Same execCommand('insertText') -> InputEvent fallback proven in
  // chatWindows.ts's WHATSAPP_INSERT_TEXT_TEMPLATE — handles both plain
  // inputs and React-controlled ones.
  let inserted = false;
  try {
    if (typeof el.select === 'function') el.select();
    document.execCommand('selectAll', false, undefined);
    document.execCommand('delete', false, undefined);
    inserted = document.execCommand('insertText', false, text);
  } catch (e) { inserted = false; }
  if (!inserted) {
    if ('value' in el) {
      el.value = text;
    } else {
      el.textContent = text;
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: text, inputType: 'insertText' }));
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));

  const current = ('value' in el ? el.value : (el.innerText || el.textContent || '')).trim();
  return { ok: true, currentText: current };
})()
`;
}

export async function readPageText(): Promise<any> {
  const script = READ_PAGE_TEXT_SCRIPT.replace(/__CAP__/g, String(PAGE_TEXT_CHAR_CAP));
  return runOnPage(script);
}

export async function listClickableElements(): Promise<any> {
  const script = LIST_CLICKABLE_SCRIPT.replace('__MAXN__', String(MAX_CLICKABLE_ELEMENTS));
  return runOnPage(script);
}

export async function clickElement(index: number): Promise<{ ok: boolean; error?: string }> {
  const lookup = await runOnPage(elementLookupScript(index));
  if (!lookup?.found) {
    return { ok: false, error: `Element at index ${index} was not found — the page may have changed. Call find_web_element or read_web_page again.` };
  }
  const result = await runOnPage(CLICK_LOOKED_UP_ELEMENT_SCRIPT);
  if (!result?.ok) return { ok: false, error: result?.error || 'Could not click that element.' };
  return { ok: true };
}

export async function typeIntoElement(index: number, text: string): Promise<{ ok: boolean; error?: string; currentText?: string }> {
  const lookup = await runOnPage(elementLookupScript(index));
  if (!lookup?.found) {
    return { ok: false, error: `Element at index ${index} was not found — the page may have changed. Call find_web_element or read_web_page again.` };
  }
  const result = await runOnPage(typeIntoLookedUpElementScript(text));
  if (!result?.ok) return { ok: false, error: result?.error || 'Could not type into that element.' };
  return { ok: true, currentText: result.currentText };
}
