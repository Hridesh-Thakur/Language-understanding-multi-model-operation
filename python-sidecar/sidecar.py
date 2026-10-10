"""
Anushka AI — Windows automation sidecar.

Communicates over stdio using newline-delimited JSON-RPC:
  request:  {"id": "...", "method": "move_mouse", "params": {...}}
  response: {"id": "...", "result": {...}}           on success
            {"id": "...", "error": "message"}         on failure

This process is spawned by the Electron main process (electron/tools/sidecarClient.ts)
and NEVER receives raw shell strings from the AI — only a method name plus
structured, JSON-typed parameters, matching the tool registry in
electron/tools/registry.ts.

Build for distribution with:
    pyinstaller --onefile --name sidecar sidecar.py
"""

import sys
import json
import base64
import io
import traceback

# All of these are Windows-only and only imported when actually running on
# Windows, so this file can still be type-checked / partially exercised on
# other platforms during development.
IS_WINDOWS = sys.platform == "win32"

if IS_WINDOWS:
    import pyautogui          # mouse / keyboard
    import pygetwindow as gw  # window enumeration / control
    import psutil              # processes, system telemetry
    import pyperclip            # clipboard (backup path; Electron owns primary clipboard)
    import mss                  # screenshots
    import mss.tools
    try:
        import screen_brightness_control as sbc
    except ImportError:
        sbc = None
    try:
        from ctypes import cast, POINTER
        from comtypes import CLSCTX_ALL
        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
        _HAS_PYCAW = True
    except ImportError:
        _HAS_PYCAW = False

    pyautogui.FAILSAFE = True  # move mouse to a screen corner to abort automation


def _get_volume_iface():
    devices = AudioUtilities.GetSpeakers()
    interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
    return cast(interface, POINTER(IAudioEndpointVolume))


# ---------------------------------------------------------------------------
# Method handlers
# ---------------------------------------------------------------------------

def h_move_mouse(params):
    pyautogui.moveTo(params["x"], params["y"], duration=params.get("duration", 0.2))
    return {"success": True}


def h_click_mouse(params):
    button = params.get("button", "left")
    if params.get("double"):
        pyautogui.doubleClick(button=button)
    else:
        pyautogui.click(button=button)
    return {"success": True}


def h_scroll_mouse(params):
    pyautogui.scroll(params.get("amount", -300))
    return {"success": True}


def h_type_text(params):
    pyautogui.write(params["text"], interval=params.get("interval", 0.02))
    return {"success": True}


def h_press_key(params):
    pyautogui.press(params["key"])
    return {"success": True}


def h_hotkey(params):
    pyautogui.hotkey(*params["keys"])
    return {"success": True}


def h_list_windows(params):
    wins = []
    for w in gw.getAllWindows():
        if w.title.strip():
            wins.append({
                "title": w.title,
                "left": w.left, "top": w.top,
                "width": w.width, "height": w.height,
                "isActive": w.isActive,
                "isMinimized": w.isMinimized,
            })
    return {"success": True, "windows": wins}


def _find_window(title_query):
    matches = gw.getWindowsWithTitle(title_query)
    if not matches:
        # fallback: substring match against all windows
        matches = [w for w in gw.getAllWindows() if title_query.lower() in w.title.lower()]
    return matches[0] if matches else None


def h_focus_window(params):
    w = _find_window(params["title"])
    if not w:
        raise RuntimeError(f'No window matching "{params["title"]}"')
    w.activate()
    return {"success": True}


def h_minimize_window(params):
    w = _find_window(params["title"])
    if not w:
        raise RuntimeError(f'No window matching "{params["title"]}"')
    w.minimize()
    return {"success": True}


def h_maximize_window(params):
    w = _find_window(params["title"])
    if not w:
        raise RuntimeError(f'No window matching "{params["title"]}"')
    w.maximize()
    return {"success": True}


def h_restore_window(params):
    w = _find_window(params["title"])
    if not w:
        raise RuntimeError(f'No window matching "{params["title"]}"')
    w.restore()
    return {"success": True}


def h_move_window(params):
    w = _find_window(params["title"])
    if not w:
        raise RuntimeError(f'No window matching "{params["title"]}"')
    w.moveTo(params["x"], params["y"])
    return {"success": True}


def h_resize_window(params):
    w = _find_window(params["title"])
    if not w:
        raise RuntimeError(f'No window matching "{params["title"]}"')
    w.resizeTo(params["width"], params["height"])
    return {"success": True}


def h_close_window(params):
    w = _find_window(params["title"])
    if not w:
        raise RuntimeError(f'No window matching "{params["title"]}"')
    w.close()
    return {"success": True}


def _cheap_ahash(shot):
    """8x8 average-hash computed from a handful of sampled pixels, NOT a
    full-image scan — this exists purely so electron/main/screenAwareness.ts
    can tell "basically the same screen" from "something changed" between
    ticks of its periodic loop without paying for a Gemini Vision call every
    time. It is intentionally coarse (64 sample points, not 64 averaged
    regions) — good enough to catch a new window/dialog/notification, not
    meant to catch a single blinking cursor. No Pillow/numpy dependency so
    it doesn't add anything to the PyInstaller build.
    Returns a 16-char hex string (64 bits).
    """
    w, h = shot.size
    raw = shot.rgb  # bytes, 3 bytes/pixel, row-major
    stride = w * 3
    grid = 8
    samples = []
    for gy in range(grid):
        for gx in range(grid):
            px = min(w - 1, int((gx + 0.5) * w / grid))
            py = min(h - 1, int((gy + 0.5) * h / grid))
            offset = py * stride + px * 3
            if offset + 3 <= len(raw):
                r, g, b = raw[offset], raw[offset + 1], raw[offset + 2]
                samples.append((r + g + b) // 3)
            else:
                samples.append(0)
    avg = sum(samples) / len(samples)
    bits = "".join("1" if s > avg else "0" for s in samples)
    return "%016x" % int(bits, 2)


def h_take_screenshot(params):
    region = params.get("region")  # {left, top, width, height} or None = full screen
    with mss.mss() as sct:
        monitor = sct.monitors[1] if not region else {
            "left": region["left"], "top": region["top"],
            "width": region["width"], "height": region["height"],
        }
        shot = sct.grab(monitor)
        png_bytes = mss.tools.to_png(shot.rgb, shot.size)
        # Computed from the same in-memory grab, before PNG encoding, so this
        # costs a handful of extra list lookups, not another capture.
        ahash = _cheap_ahash(shot)
    b64 = base64.b64encode(png_bytes).decode("ascii")
    return {"success": True, "imageBase64": b64, "mimeType": "image/png", "hash": ahash}


def h_set_volume(params):
    if not _HAS_PYCAW:
        raise RuntimeError("pycaw not installed")
    pct = max(0, min(100, params["percent"])) / 100.0
    vol = _get_volume_iface()
    vol.SetMasterVolumeLevelScalar(pct, None)
    return {"success": True}


def h_mute_volume(params):
    if not _HAS_PYCAW:
        raise RuntimeError("pycaw not installed")
    vol = _get_volume_iface()
    vol.SetMute(1 if params.get("mute", True) else 0, None)
    return {"success": True}


def h_set_brightness(params):
    if sbc is None:
        raise RuntimeError("screen_brightness_control not installed")
    sbc.set_brightness(max(0, min(100, params["percent"])))
    return {"success": True}


def h_get_system_info(params):
    vm = psutil.virtual_memory()
    return {
        "success": True,
        "cpuPercent": psutil.cpu_percent(interval=0.3),
        "memPercent": vm.percent,
        "memTotalGB": round(vm.total / 1e9, 1),
        "battery": (psutil.sensors_battery()._asdict() if psutil.sensors_battery() else None),
        "bootTime": psutil.boot_time(),
    }


def h_list_processes(params):
    limit = params.get("limit", 30)
    procs = []
    for p in psutil.process_iter(["pid", "name", "memory_percent", "cpu_percent"]):
        try:
            procs.append(p.info)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    procs.sort(key=lambda x: x.get("memory_percent") or 0, reverse=True)
    return {"success": True, "processes": procs[:limit]}


# Windows PIDs that must never be killed via this tool, even with confirmation.
_PROTECTED_NAMES = {
    "system", "system idle process", "csrss.exe", "wininit.exe", "winlogon.exe",
    "services.exe", "lsass.exe", "smss.exe", "explorer.exe",
}


def h_kill_process(params):
    name = params.get("name", "").lower()
    pid = params.get("pid")
    if name in _PROTECTED_NAMES:
        raise RuntimeError(f'Refusing to terminate protected system process "{name}"')
    target = None
    if pid:
        target = psutil.Process(pid)
    else:
        for p in psutil.process_iter(["pid", "name"]):
            if p.info["name"] and p.info["name"].lower() == name:
                target = p
                break
    if not target:
        raise RuntimeError(f'Process "{name or pid}" not found')
    target.terminate()
    return {"success": True}


def h_get_monitors(params):
    with mss.mss() as sct:
        # monitors[0] is the "all monitors" virtual bounding box; skip it.
        mons = sct.monitors[1:]
    return {
        "success": True,
        "monitors": [
            {"index": i + 1, "left": m["left"], "top": m["top"], "width": m["width"], "height": m["height"]}
            for i, m in enumerate(mons)
        ],
    }


def h_move_window_to_monitor(params):
    w = _find_window(params["title"])
    if not w:
        raise RuntimeError(f'No window matching "{params["title"]}"')
    with mss.mss() as sct:
        mons = sct.monitors[1:]
    idx = params.get("monitor", 1) - 1
    if idx < 0 or idx >= len(mons):
        raise RuntimeError(f'Monitor {params.get("monitor")} does not exist ({len(mons)} detected)')
    mon = mons[idx]
    w.moveTo(mon["left"] + 40, mon["top"] + 40)
    return {"success": True, "monitor": idx + 1}


_MEDIA_KEYS = {
    "play_pause": "playpause",
    "play": "playpause",
    "pause": "playpause",
    "next": "nexttrack",
    "previous": "prevtrack",
    "stop": "stop",
    "volume_up": "volumeup",
    "volume_down": "volumedown",
    "mute": "volumemute",
}


def h_media_key(params):
    action = (params.get("action") or "play_pause").lower()
    key = _MEDIA_KEYS.get(action)
    if not key:
        raise RuntimeError(f'Unknown media action "{action}"')
    pyautogui.press(key)
    return {"success": True, "action": action}


# Distinct from generic press_key so the risk policy can require an explicit
# confirmation specifically for "actually send this message" while ordinary
# Enter presses elsewhere (e.g. inside a text editor) stay lower friction.
#
# method="enter" (default) — WhatsApp / Telegram compose boxes send on Enter.
# method="ctrl_enter" — Gmail's compose window sends on Ctrl+Enter instead
# (plain Enter just inserts a newline there), so prepare_email_message tells
# the model to pass this explicitly.
def h_send_prepared_message(params):
    method = (params.get("method") or "enter").lower()
    if method == "ctrl_enter":
        pyautogui.hotkey("ctrl", "enter")
    else:
        pyautogui.press("enter")
    return {"success": True, "method": method}


def h_get_clipboard(params):
    return {"success": True, "text": pyperclip.paste()}


def h_set_clipboard(params):
    pyperclip.copy(params.get("text", ""))
    return {"success": True}


def h_ping(params):
    return {"success": True, "pong": True}


HANDLERS = {
    "ping": h_ping,
    "move_mouse": h_move_mouse,
    "click_mouse": h_click_mouse,
    "scroll_mouse": h_scroll_mouse,
    "type_text": h_type_text,
    "press_key": h_press_key,
    "hotkey": h_hotkey,
    "list_windows": h_list_windows,
    "focus_window": h_focus_window,
    "minimize_window": h_minimize_window,
    "maximize_window": h_maximize_window,
    "restore_window": h_restore_window,
    "move_window": h_move_window,
    "resize_window": h_resize_window,
    "close_window": h_close_window,
    "take_screenshot": h_take_screenshot,
    "set_volume": h_set_volume,
    "mute_volume": h_mute_volume,
    "set_brightness": h_set_brightness,
    "get_system_info": h_get_system_info,
    "list_processes": h_list_processes,
    "kill_process": h_kill_process,
    "get_clipboard": h_get_clipboard,
    "set_clipboard": h_set_clipboard,
    "get_monitors": h_get_monitors,
    "move_window_to_monitor": h_move_window_to_monitor,
    "media_key": h_media_key,
    "send_prepared_message": h_send_prepared_message,
}


def main():
    # Unbuffered line-based JSON-RPC over stdio.
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue

        req_id = req.get("id")
        method = req.get("method")
        params = req.get("params", {})

        try:
            if not IS_WINDOWS:
                raise RuntimeError("Sidecar only supports Windows")
            handler = HANDLERS.get(method)
            if not handler:
                raise RuntimeError(f'Unknown method "{method}"')
            result = handler(params)
            resp = {"id": req_id, "result": result}
        except Exception as e:  # noqa: BLE001 — must always reply, never crash silently
            resp = {"id": req_id, "error": str(e)}
            print(traceback.format_exc(), file=sys.stderr)

        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
