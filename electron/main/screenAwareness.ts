// electron/main/screenAwareness.ts
//
// Pass 6 — "continuous screen awareness", scoped down to what that can
// actually mean responsibly: a PERIODIC scan loop, not a realtime video
// feed. On a timer (electron/security/settings.ts:
// screenAwarenessIntervalSec, default 25s), while
// screenAwarenessEnabled is on:
//
//   1. Ask the sidecar for a screenshot (it now also returns a cheap
//      64-bit on-device hash of the image — see sidecar.py:_cheap_ahash).
//   2. If that hash is close enough to the previous tick's hash, assume
//      nothing meaningfully changed and DON'T call the Gemini API — just
//      refresh the "last checked" timestamp. This is the actual cost/
//      privacy control: most ticks on an idle machine cost nothing.
//   3. Otherwise, send the screenshot to server.ts's /api/vision/
//      analyze-screen route in a new "ambient" mode that returns a short
//      summary plus a `notable` flag (new dialog/error/permission prompt/
//      security warning — NOT routine typing/scrolling/video playback).
//   4. Cache the result so get_screen_context (a LOW-risk, read-only tool
//      — electron/tools/nodeTools.ts) can answer "what's been happening on
//      screen" instantly, with no fresh capture, no added latency.
//   5. If `notable` came back true, tell the renderer so it can show a
//      passive, dismissible UI notice (src/App.tsx / ScreenAwarenessNotice).
//      This deliberately does NOT inject anything into the live voice
//      conversation on its own — Anushka does not start talking about
//      something it silently noticed. The user has to ask.
//
// Deliberately NOT persisted to disk, and deliberately NOT toggleable by a
// voice/tool call — turning this on always requires an explicit tap in the
// Settings modal (see src/components/SettingsModal.tsx), because it's the
// one feature in this app that sends screenshots to an external API
// without a per-call user action. That's a judgment call, not a hard
// platform constraint — if you'd rather allow "hey Anushka, keep an eye on
// my screen" as a voice command, that's a small addition here plus a new
// LOW/MEDIUM riskPolicy.ts entry, not a rewrite.

import { BrowserWindow } from 'electron';
import { getSettings } from '../security/settings';
import { callSidecar } from '../tools/sidecarClient';
import { logAction } from './logger';

export interface ScreenAwarenessState {
  summary: string;
  notable: boolean;
  notableReason?: string;
  capturedAt: number;   // epoch ms of the last actual Vision call
  checkedAt: number;    // epoch ms of the last tick, even if it skipped Vision
}

let state: ScreenAwarenessState | null = null;
let lastHash: string | null = null;
let win: BrowserWindow | null = null;
let timer: NodeJS.Timeout | null = null;
let ticking = false; // reentrancy guard — never overlap two in-flight ticks

const VISION_ENDPOINT = process.env.ANUSHKA_VISION_ENDPOINT || 'http://localhost:3000/api/vision/analyze-screen';

// Hamming distance between two 16-char hex strings (64-bit hashes). Below
// this many differing bits out of 64, we treat the screen as "unchanged"
// and skip the Vision call. This is a coarse 8x8 sample grid (see
// sidecar.py), so a genuinely new window/dialog reliably moves this a lot
// more than 6 bits; ordinary text-cursor blinking or a clock tick usually
// moves it 0-2.
const CHANGE_THRESHOLD_BITS = 6;

function hammingDistanceHex(a: string, b: string): number {
  try {
    let x = BigInt('0x' + a) ^ BigInt('0x' + b);
    let count = 0;
    while (x > 0n) {
      count += Number(x & 1n);
      x >>= 1n;
    }
    return count;
  } catch {
    return 64; // malformed hash -> treat as "definitely changed"
  }
}

export function getScreenContext(): ScreenAwarenessState & { enabled: boolean } {
  const enabled = getSettings().screenAwarenessEnabled;
  if (!state) {
    return {
      enabled,
      summary: enabled
        ? "Screen awareness is on but hasn't completed a check yet — try again in a few seconds."
        : 'Screen awareness is off. Turn it on in Settings if you want me to keep light background track of what changes on screen.',
      notable: false,
      capturedAt: 0,
      checkedAt: 0,
    };
  }
  return { ...state, enabled };
}

async function tick() {
  if (ticking) return;
  const settings = getSettings();
  if (!settings.screenAwarenessEnabled || !win || win.isDestroyed()) return;

  ticking = true;
  try {
    const shot = await callSidecar('take_screenshot', {});
    if (!shot?.success || !shot?.imageBase64) return;

    const now = Date.now();
    const hash: string | undefined = shot.hash;
    const changed = !lastHash || !hash || hammingDistanceHex(lastHash, hash) >= CHANGE_THRESHOLD_BITS;

    if (!changed) {
      if (state) state.checkedAt = now;
      return;
    }
    if (hash) lastHash = hash;

    const res = await fetch(VISION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: shot.imageBase64,
        mimeType: shot.mimeType || 'image/png',
        mode: 'ambient',
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Vision request failed (HTTP ${res.status})`);

    let parsed: any = {};
    try {
      parsed = JSON.parse((data.text || '').trim());
    } catch {
      parsed = { summary: (data.text || '').trim().slice(0, 300), notable: false };
    }

    state = {
      summary: String(parsed.summary || '').slice(0, 400),
      notable: Boolean(parsed.notable),
      notableReason: parsed.notableReason ? String(parsed.notableReason).slice(0, 200) : undefined,
      capturedAt: now,
      checkedAt: now,
    };

    if (state.notable && win && !win.isDestroyed()) {
      win.webContents.send('anushka:screen-notable-change', {
        summary: state.summary,
        reason: state.notableReason,
        at: now,
      });
    }
  } catch (err: any) {
    // Best-effort background loop — a failed tick (sidecar not ready yet,
    // server.ts not running, transient network error) just means the next
    // tick tries again. Log it so it's visible in the same place every
    // other tool failure is, but never surface it to the user as an error.
    logAction({ tool: 'screen_awareness_tick', args: {}, risk: 'low', decision: 'ALLOW', success: false, error: err?.message || String(err) });
  } finally {
    ticking = false;
  }
}

export function startScreenAwarenessLoop(mainWindow: BrowserWindow) {
  win = mainWindow;
  if (timer) return; // already running

  const scheduleNext = async () => {
    await tick();
    const intervalMs = Math.max(10, getSettings().screenAwarenessIntervalSec) * 1000;
    timer = setTimeout(scheduleNext, intervalMs);
  };

  // Give the sidecar + local server a few seconds to finish starting up
  // before the first tick, same startup order the rest of the app relies on.
  timer = setTimeout(scheduleNext, 5000);
}

export function stopScreenAwarenessLoop() {
  if (timer) clearTimeout(timer);
  timer = null;
}
