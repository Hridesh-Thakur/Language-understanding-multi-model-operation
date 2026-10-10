// electron/tools/androidTools.ts
//
// Android phone control over ADB (Android Debug Bridge). Same safety
// philosophy as nodeTools.ts: every call here is execFile('adb', [fixed,
// argument, array]) — never a shell string built from AI-provided text. The
// model only ever picks a tool name + structured args (a device id, an app
// name, a volume delta); it never supplies a raw adb/shell command.
//
// HONEST LIMITS (tell the user these plainly, don't oversell):
//  - First-time pairing of a NEW phone always needs one manual step on the
//    phone: either approving the "Allow USB debugging?" popup, or entering
//    a 6-digit Wireless Debugging pairing code once. There is no way to
//    skip that first handshake — Android requires it for security. After
//    that one-time pairing, the same phone can be found and reconnected
//    automatically with no popup and no code.
//  - "Unlock" cannot bypass a PIN/pattern/fingerprint lock. No tool can do
//    that without root — it would defeat the point of a lock screen. We can
//    only wake the screen and, if the phone has NO lock set, dismiss the
//    swipe-up screen.

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function adb(args: string[], serial?: string): Promise<string> {
  const full = serial ? ['-s', serial, ...args] : args;
  try {
    const { stdout } = await execFileAsync('adb', full, { timeout: 15000 });
    return stdout.trim();
  } catch (err: any) {
    // Surface adb's own stderr (e.g. "device unauthorized", "no devices") —
    // far more useful to the model/user than a generic Node error.
    const msg = err?.stderr?.trim() || err?.message || String(err);
    throw new Error(msg);
  }
}

export interface AndroidDevice {
  id: string; // serial (USB) or ip:port (wireless)
  status: 'device' | 'unauthorized' | 'offline' | string;
  model?: string;
}

// Lists devices ADB already knows about: currently connected (USB or
// previously `adb connect`-ed wireless devices), plus — if the installed
// platform-tools version supports it — nearby PAIRED phones advertising
// Wireless Debugging on the same Wi-Fi network via `adb mdns services`.
// A phone that has never been paired with this PC before will NOT show up
// here; see the module comment above for why that first step can't be
// skipped.
export async function listAndroidDevices(): Promise<{ success: boolean; devices?: AndroidDevice[]; error?: string }> {
  try {
    const out = await adb(['devices', '-l']);
    const lines = out.split('\n').slice(1).filter((l) => l.trim());
    const devices: AndroidDevice[] = lines.map((line) => {
      const [id, status, ...rest] = line.trim().split(/\s+/);
      const modelPart = rest.find((p) => p.startsWith('model:'));
      return { id, status: status as any, model: modelPart?.replace('model:', '') };
    });

    // Best-effort: nearby paired-but-not-yet-connected phones broadcasting
    // over mDNS. Older platform-tools don't support this subcommand — swallow
    // that failure silently and just return what `adb devices` already found.
    try {
      const mdnsOut = await adb(['mdns', 'services']);
      const mdnsLines = mdnsOut.split('\n').slice(1).filter((l) => /_adb-tls-connect/.test(l));
      for (const line of mdnsLines) {
        const parts = line.trim().split(/\s+/);
        const addr = parts[2]; // ip:port
        if (addr && !devices.some((d) => d.id === addr)) {
          devices.push({ id: addr, status: 'offline' }); // discovered, not yet `adb connect`-ed
        }
      }
    } catch {
      // mdns subcommand unsupported — fine, not fatal.
    }

    return { success: true, devices };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Connects to a device already known to ADB (USB-attached, or a phone that
// was paired with Wireless Debugging before — see module comment). `target`
// can be a serial or an ip:port from listAndroidDevices().
export async function connectAndroidDevice(args: { target: string }): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!args?.target) return { success: false, error: 'No target device specified.' };
  try {
    const out = await adb(['connect', args.target]);
    if (/unable to connect|failed|cannot/i.test(out)) {
      return { success: false, error: out };
    }
    return { success: true, message: out };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// One-time Wireless Debugging pairing (Android 11+). `hostPort` and `code`
// come from the phone's Settings > Developer Options > Wireless debugging >
// "Pair device with pairing code" screen. This is the one manual step that
// can't be automated away — see module comment.
export async function pairAndroidDevice(args: { hostPort: string; code: string }): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!args?.hostPort || !args?.code) return { success: false, error: 'Pairing needs both the IP:port and the 6-digit code shown on the phone.' };
  try {
    const out = await execFileAsync('adb', ['pair', args.hostPort, args.code], { timeout: 15000 });
    return { success: true, message: out.stdout.trim() };
  } catch (err: any) {
    return { success: false, error: err?.stderr?.trim() || err.message };
  }
}

const APP_PACKAGES: Record<string, string> = {
  whatsapp: 'com.whatsapp',
  youtube: 'com.google.android.youtube',
  instagram: 'com.instagram.android',
  telegram: 'org.telegram.messenger',
  chrome: 'com.android.chrome',
  gmail: 'com.google.android.gm',
  camera: 'com.android.camera2',
  settings: 'com.android.settings',
};

export async function androidOpenApp(args: { app: string; device?: string }): Promise<{ success: boolean; error?: string }> {
  const key = (args?.app || '').toLowerCase().trim();
  const pkg = APP_PACKAGES[key];
  if (!pkg) {
    return { success: false, error: `Don't have a package mapping for "${args?.app}". Known apps: ${Object.keys(APP_PACKAGES).join(', ')}.` };
  }
  try {
    await adb(['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], args?.device);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Locks the phone (screen off) — same as pressing the power button once.
// Always safe/reversible: the user's own PIN/pattern/fingerprint still
// guards it exactly as normal.
export async function androidLock(args: { device?: string }): Promise<{ success: boolean; error?: string }> {
  try {
    await adb(['shell', 'input', 'keyevent', 'KEYCODE_POWER'], args?.device);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Wakes the screen and, if the phone has no lock set, swipes it up. This
// CANNOT and does not attempt to bypass a PIN/pattern/fingerprint — if the
// phone is actually secured, the swipe just reveals the lock screen for the
// user to unlock themselves.
export async function androidWake(args: { device?: string }): Promise<{ success: boolean; note: string; error?: string }> {
  try {
    await adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'], args?.device);
    await adb(['shell', 'input', 'swipe', '540', '1800', '540', '800'], args?.device);
    return { success: true, note: "Screen woken. If the phone has a PIN/pattern/fingerprint, the user still has to unlock it themselves — that can't be bypassed." };
  } catch (err: any) {
    return { success: false, note: '', error: err.message };
  }
}

export async function androidSetVolume(args: { direction: 'up' | 'down' | 'mute'; device?: string }): Promise<{ success: boolean; error?: string }> {
  const key = args?.direction === 'up' ? 'KEYCODE_VOLUME_UP' : args?.direction === 'down' ? 'KEYCODE_VOLUME_DOWN' : 'KEYCODE_VOLUME_MUTE';
  try {
    await adb(['shell', 'input', 'keyevent', key], args?.device);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// level: 0-255 (Android's raw screen_brightness range).
export async function androidSetBrightness(args: { level: number; device?: string }): Promise<{ success: boolean; error?: string }> {
  const level = Math.max(0, Math.min(255, Math.round(args?.level ?? 128)));
  try {
    await adb(['shell', 'settings', 'put', 'system', 'screen_brightness', String(level)], args?.device);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
