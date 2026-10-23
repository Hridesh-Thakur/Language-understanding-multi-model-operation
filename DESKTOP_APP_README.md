# Lumo AI — Windows Desktop App

This adds a real Electron desktop shell + Windows automation layer on top of
your existing Lumo AI web app, **without changing the UI**. It was written
and syntax-checked in a Linux sandbox — Electron and the Python sidecar are
Windows-targeted and must be built/tested on an actual Windows machine.

## What's implemented

- **Electron shell** (`electron/main`, `electron/preload`) — frameless,
  transparent window (keeps your holographic UI), system tray, minimize-to-
  tray background mode, "Start with Windows" toggle, emergency-stop menu item.
- **Secure IPC** — `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`. The renderer only ever gets `window.anushka.invokeTool(...)`
  via `contextBridge` — no raw Node/`fs`/`child_process` exposure.
- **Risk-tiered tool registry** (`electron/security/riskPolicy.ts`,
  `electron/tools/registry.ts`) — every tool call is classified low/medium/high
  risk. Medium+ risk (and *all* shutdown/restart/sleep/hibernate/sign-out/
  delete/kill-process calls, unconditionally) trigger a confirmation prompt in
  the UI (`ConfirmationOverlay.tsx`) before anything executes. A 30s silent
  timeout auto-denies.
- **Node-side tools** (`electron/tools/nodeTools.ts`) — app launch/close via a
  Start-Menu shortcut registry (not a hardcoded 5-app list), power controls via
  fixed `shutdown.exe`/`rundll32` argv (never a shell string), clipboard, file
  create/rename/copy/move/delete/search.
- **Python sidecar** (`python-sidecar/sidecar.py`) — JSON-RPC over stdio for
  everything that needs real Windows APIs: mouse/keyboard (`pyautogui`),
  window enumeration/move/resize/focus (`pygetwindow`), screenshots (`mss`),
  volume (`pycaw`), brightness (`screen_brightness_control`), process
  list/kill with a protected-process denylist (`psutil`).
- **Gemini tool declarations** added to `server.ts` so Lumo can actually
  call all of the above through voice, plus a system-instruction note telling
  the model these are Windows-app-only and confirmation is handled by the app.
- **Emergency stop** — saying "Lumo stop" (or the tray menu item) sets a
  global flag checked before every tool call; "Lumo resume" clears it.

## What's intentionally NOT built yet (needs a decision from you first)

- **Wake-word engine** — needs a specific engine + API key (e.g. Picovoice
  Porcupine is the usual free-tier choice). Nothing here fakes this.
- **Browser automation** (open tabs, click/type on web pages) — best done with
  Playwright launched by the sidecar; not wired in.
- **AI screen vision** ("what's wrong with this screen") — `take_screenshot`
  works now; feeding that PNG to Gemini for analysis is a small addition once
  you confirm you want screenshots leaving the machine to the Gemini API.
- **Media-key control** — needs one more sidecar handler (trivial, skipped
  for scope).

## Setup (run on Windows)

```bash
# 1. Install Node deps
npm install

# 2. Python sidecar deps
cd python-sidecar
pip install -r requirements.txt
cd ..

# 3. Add your Gemini key
cp .env.example .env
# edit .env -> GEMINI_API_KEY=...
```

## Development

```bash
npm run electron:dev
```
Runs the Express/Vite dev server + Electron together, with the sidecar spawned
automatically (via `python` on PATH) when the app starts.

## Production build → Windows installer

```bash
npm run dist
```
This runs, in order: `vite build` (web UI) → esbuild bundle of
`electron/main` and `electron/preload` → `pyinstaller --onefile` on
`python-sidecar/sidecar.py` (produces `python-sidecar/dist/sidecar.exe`) →
`electron-builder --win`, which produces `release/Lumo AI Setup <version>.exe`.

Replace `build/icon.png`/add a proper `build/icon.ico` before shipping — a
placeholder icon is included so the config is valid out of the box.

## Safety notes carried into the code

- No tool ever receives or executes a raw shell/PowerShell string built from
  AI output — every OS call uses a fixed executable + argument array.
- Locking never bypasses Windows auth; unlocking still requires the normal
  password/PIN/Windows Hello.
- `kill_process` refuses a denylist of core OS processes
  (`explorer.exe`, `csrss.exe`, `wininit.exe`, `lsass.exe`, etc.) even with
  confirmation.
- Recursive folder deletion requires `recursive: true` explicitly *and* still
  goes through the high-risk confirmation prompt.
 