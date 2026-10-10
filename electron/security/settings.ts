// electron/security/settings.ts
//
// Small persisted settings store, read by BOTH electron/main/index.ts (IPC
// handlers) and electron/tools/registry.ts (the permission decision at
// execution time), so there is exactly one source of truth for whether
// Trusted Mode is on. Deliberately NOT electron-store or any extra
// dependency — just a plain JSON file next to macros.json/contacts.json in
// userData, using the same fs pattern as the rest of the app.

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface AppSettings {
  // When true, NORMAL_RISK ("medium") tools execute immediately instead of
  // showing a confirmation prompt. HIGH-risk tools (and anything in
  // riskPolicy.ts's ALWAYS_CONFIRM set) ALWAYS confirm regardless of this
  // flag — Trusted Mode never touches that tier. Defaults to true because
  // the whole point of this app is to act like a real agent instead of
  // asking "Allow?" for every open/click/type.
  trustedMode: boolean;
  voiceLanguage: 'auto' | 'en' | 'hi' | 'hinglish';
  alwaysListening: boolean;

  // Pass 6 — periodic (NOT continuous/realtime) screen awareness. OFF by
  // default: this is the one setting in this file that causes a screenshot
  // to be sent to the Gemini API on a timer with no user action per call,
  // so it should be an explicit opt-in via the Settings modal, not
  // something that turns itself on. See electron/main/screenAwareness.ts.
  screenAwarenessEnabled: boolean;
  // Seconds between ticks. Each tick only calls Vision if the cheap
  // on-device hash says the screen actually changed since the last call —
  // this is a ceiling on frequency, not a guaranteed API-call cadence.
  screenAwarenessIntervalSec: number;
}

const DEFAULTS: AppSettings = {
  trustedMode: true,
  voiceLanguage: 'auto',
  alwaysListening: true,
  screenAwarenessEnabled: false,
  screenAwarenessIntervalSec: 25,
};

function settingsFilePath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

let cache: AppSettings | null = null;

function readFromDisk(): AppSettings {
  try {
    const raw = fs.readFileSync(settingsFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getSettings(): AppSettings {
  if (!cache) cache = readFromDisk();
  return cache;
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  cache = { ...getSettings(), ...patch };
  try {
    fs.mkdirSync(path.dirname(settingsFilePath()), { recursive: true });
    fs.writeFileSync(settingsFilePath(), JSON.stringify(cache, null, 2), 'utf-8');
  } catch {
    // Best-effort persistence — in-memory cache still reflects the change
    // for the rest of this session even if the write fails.
  }
  return cache;
}

export function isTrustedMode(): boolean {
  return getSettings().trustedMode;
}
