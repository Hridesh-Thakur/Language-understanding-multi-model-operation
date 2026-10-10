# Lumo AI — Desktop Control Upgrade Notes

This upgrade extends the existing Electron + Gemini Live architecture. Nothing
was rebuilt — `server.ts`, the UI components, `electron/main`, and the
existing tool registry/risk-policy/sidecar pattern are all preserved and
built on.

## Pass 1 — Desktop control foundation

**electron/tools/nodeTools.ts**
- Browser & media: `open_browser`, `open_url`, `search_web`, `search_youtube`,
  `open_spotify`.
- WhatsApp / Telegram: `open_whatsapp`, `prepare_whatsapp_message`,
  `open_telegram`, `prepare_telegram_message`. These only pre-fill a message
  via `wa.me` / `t.me` deep links into the user's already-authenticated
  session — they never touch login/auth. Actually sending is a separate,
  always-confirmed step.
- Windows settings/tools launcher: `open_windows_settings` (Display, Sound,
  Bluetooth, Network, Wi-Fi, Personalization, Update, Power, Printers, etc.)
  and `open_system_tool` (Task Manager, Device Manager, Disk Management,
  Services, Event Viewer, Control Panel, Registry Editor, terminals, Explorer).
- Safe terminal: `run_safe_command` — fixed allowlist
  (ipconfig/ping/whoami/systeminfo/tasklist/netstat/dir/node/npm/python/pip/git/code/where),
  fixed argv via `execFile` (never a shell string), 10s default timeout.
- `open_in_vscode` for the dev workflow section of the spec.
- Macro/automation engine: `create_macro` / `run_macro` / `list_macros` /
  `delete_macro`, stored as JSON under Electron's `userData` folder, plus an
  ad-hoc `run_automation` for one-off multi-step requests ("open Chrome,
  search YouTube for X, then open Discord"). Both re-enter the same
  `executeTool()` risk-checked path per step, so a macro can never bypass a
  step's own confirmation requirement, and the run stops on the first failed
  step and reports each step's outcome.
- App discovery now also does a shallow scan of `Program Files`,
  `Program Files (x86)`, and `%LOCALAPPDATA%\Programs` (in addition to the
  existing Start Menu scan) for apps with no shortcut.

**python-sidecar/sidecar.py**
- `get_monitors` / `move_window_to_monitor` for multi-monitor support.
- `media_key` (play/pause, next, previous, stop, volume up/down, mute) for
  controlling whatever's currently playing.
- `send_prepared_message` — a single Enter keypress, kept as its own method
  (rather than reusing generic `press_key`) so the risk policy can force a
  confirmation specifically on "actually send this" without adding friction
  to ordinary typing.
- No new Python dependencies — `mss` and `pygetwindow` already cover this.

**electron/security/riskPolicy.ts**
- New tools classified: browser/search/media/settings/terminal/macro-listing
  = low; WhatsApp/Telegram *preparation*, `open_system_tool`,
  `move_window_to_monitor`, macro create/delete/run = medium;
  `send_prepared_message` = high + always-confirm (same tier as
  shutdown/restart/delete/kill_process).

**electron/tools/registry.ts**
- Wires all the above into `NODE_HANDLERS` / `SIDECAR_TOOLS`.
- Adds `run_macro` / `run_automation` as a special dispatch path that
  iterates steps through `executeTool()` recursively (full risk-check reuse).
- `Handler` type loosened from `Record<string, any>` to `any` so each tool
  can keep its own descriptive parameter type — this was actually already
  triggering `tsc` errors on the *original* handlers too; fixed as part of
  the "check every TypeScript error" pass.

**server.ts**
- Added Gemini function declarations for every new tool above.
- System instruction updated: explains the WhatsApp/Telegram
  prepare-then-confirm-then-send flow, explicitly calls out Hindi/Hinglish
  handling, and tells the model when to use `run_automation`/`run_macro`.

**src/lib/liveSession.ts**
- New tool names added to `OS_TOOL_NAMES` (so they route through the desktop
  IPC bridge) and to the human-readable tool-call summaries used in the UI's
  activity feed.

## What I verified (pass 1)

- `npx tsc --noEmit` — zero errors anywhere under `electron/` or
  `python-sidecar/` after this change (the `Handler` type fix above resolved
  errors that existed on the *original* handlers too, not just new ones).
- `python3 -m ast` parse check on `sidecar.py` — no syntax errors.
- Traced every new tool end-to-end: Gemini function declaration (server.ts)
  → `OS_TOOL_NAMES`/IPC (liveSession.ts) → `executeTool` risk check
  (registry.ts) → `NODE_HANDLERS`/`SIDECAR_TOOLS` dispatch → real
  implementation (nodeTools.ts / sidecar.py).

Remaining `tsc` errors are **pre-existing** and unrelated to this change:
`src/*.tsx` reports "could not find declaration file for module 'react'"
because `@types/react` / `@types/react-dom` aren't in `package.json`'s
`devDependencies`. This doesn't block `npm run dev`/`npm run build` (Vite
and esbuild transpile without type-checking), but if you want `npm run lint`
fully clean, run:
```
npm i -D @types/react @types/react-dom
```

## Pass 2 — WhatsApp/Telegram read + Email send

**electron/main/chatWindows.ts** (NEW)
- A dedicated, persistent Electron `BrowserWindow` per platform
  (`persist:anushka-whatsapp` / `persist:anushka-telegram` partitions, so a
  QR-code/login only has to happen once). Lumo reads from these via
  `webContents.executeJavaScript()` — a fixed, reviewed scraper script per
  platform, never anything built from AI text. Each scraper has a primary
  selector strategy plus a "whole panel" text fallback, since WhatsApp
  Web/Telegram Web are unofficial surfaces that occasionally change their
  internal DOM — expect to revisit the primary selectors if a read starts
  coming back as `strategy: "panel-fallback"` when it didn't before.
- These are a **separate** window from the `open_whatsapp`/`open_telegram`
  (desktop-app-or-external-browser) path used for sending — that path is
  unchanged. Reading and sending currently go through two different
  surfaces; unifying them (so the same window both shows and sends) is a
  reasonable follow-up but wasn't necessary for read-only access.

**electron/tools/nodeTools.ts**
- `open_whatsapp_chat_window` / `read_whatsapp_chat` and
  `open_telegram_chat_window` / `read_telegram_chat`, thin wrappers around
  `chatWindows.ts`.
- `prepare_email_message` — opens a Gmail compose URL (`to`/`subject`/`body`/
  `cc`, all pre-filled, nothing sent) via `shell.openExternal`, same pattern
  as `prepare_whatsapp_message`/`prepare_telegram_message`.

**python-sidecar/sidecar.py**
- `send_prepared_message` now takes an optional `method`: `"enter"`
  (default — WhatsApp/Telegram) or `"ctrl_enter"` (Gmail's compose window
  sends on Ctrl+Enter, not plain Enter). Still the same single
  always-confirmed tool, not a new risk-tier entry.

**electron/security/riskPolicy.ts**
- New tools classified: `open_whatsapp_chat_window` / `read_whatsapp_chat` /
  `open_telegram_chat_window` / `read_telegram_chat` = low (opening a window
  and reading are both non-destructive); `prepare_email_message` = medium,
  matching the WhatsApp/Telegram prepare tools.

**server.ts**
- Function declarations for all five new tools, and an updated
  `send_prepared_message` description covering the `method` param.
- System instruction now explains the email prepare → confirm → send flow,
  and tells the model reading a chat sends that chat's visible text —
  including the other person's messages — to the model as a normal tool
  result, with an instruction to mention that to the user once rather than
  silently.

**src/lib/liveSession.ts**
- New tool names added to `OS_TOOL_NAMES` and to `summarizeOsTool()` for the
  activity-feed toasts.

**A privacy trade-off worth knowing about, not just the model:** reading a
WhatsApp/Telegram chat sends that chat's currently-visible text to the
Gemini API as part of a normal tool call/result, the same way a screenshot
would if screen vision is added later. That includes messages from whoever
you're chatting with, not just your own. And DOM-scraping WhatsApp/Telegram
Web (rather than using an official Bot API) sits in the same gray area as
the wa.me/t.me deep links already in the app — fine for personal use the way
this is scoped (on-demand, in a window you can see, nothing automated in the
background), but worth knowing if you ever want to run this unattended or at
volume.

**What I verified**
- `npx tsc --noEmit` — zero errors across the whole project (electron/, src/,
  server.ts) after this change.
- `python3 -m ast` parse check on `sidecar.py` — no syntax errors.
- Traced each new tool end-to-end the same way as pass 1: Gemini function
  declaration (server.ts) → `OS_TOOL_NAMES`/IPC (liveSession.ts) →
  `executeTool` risk check (registry.ts) → `NODE_HANDLERS` dispatch
  (registry.ts) → real implementation (nodeTools.ts →, for the read tools,
  chatWindows.ts).
- Not runnable/testable here — Electron `BrowserWindow`s and the sidecar are
  Windows-targeted; try it on Windows with `npm run electron:dev`, then
  "Open my WhatsApp chat with +91XXXXXXXXXX" → "What did they say?" →
  "Read my last messages from [Telegram username]" → "Email [address] and
  say I'm running late" → confirm → "Send it".

## Explicitly NOT done (still spec sections 8, 30, 13/14 partial)

Being upfront about scope rather than claiming a 38-section spec is fully
done:

- **True background wake-word ("Hey Lumo") voice loop** — the app already
  minimizes to tray and keeps running; a real always-listening wake-word
  engine (e.g. Porcupine) on top of the existing push-to-talk Gemini Live
  session is a separate, self-contained addition.
- **Scheduled/timed automation** ("remind me at 8pm", "every morning") — the
  macro engine above gives you the *steps* primitive; a scheduler (e.g.
  `node-schedule` + persisted schedule file, triggering `run_macro`) is a
  small follow-up on top of it.
- **Printer print-a-specific-document**, **Bluetooth device
  discovery/status**, **network adapter enable/disable** — the *settings
  pages* for these are wired via `open_windows_settings`/`open_system_tool`;
  deeper programmatic control (WMI/PowerShell calls) wasn't added to avoid
  quietly expanding the terminal allowlist without you reviewing it first.

None of the above are stubbed with fake buttons — they simply aren't present
yet, and calling for them will just mean the model doesn't have that tool.

## Pass 3 — Screen vision / OCR ("what's on my screen?")

**server.ts** (NEW route)
- `POST /api/vision/analyze-screen` — takes `{ imageBase64, mimeType, mode,
  question?, target? }` and makes a single `generateContent` call to a
  vision-capable Gemini model (`gemini-3.1-pro-preview` by default,
  overridable via `GEMINI_VISION_MODEL` — **verify the exact model id
  against the current Gemini API docs before shipping**, preview model
  names move fast). Two modes:
  - `describe` — free-form Q&A about what's currently visible, returns 2-4
    sentences.
  - `locate` — asks for one described UI element's pixel-center coordinates
    as strict JSON (`responseMimeType: "application/json"`), for the
    find-and-click flow below.
- Kept as a plain REST route on the same Express process rather than routed
  through the Live WS session, on purpose: `GEMINI_API_KEY` stays in the one
  process that already had it, and the (potentially large) screenshot never
  has to enter the Live session's context — only the resulting text or
  coordinates do.
- Bumped the global `express.json()` limit from Express's 100kb default to
  20mb so a full-screen PNG can actually reach this route.

**electron/tools/nodeTools.ts**
- `readScreen(question?)` — takes a screenshot via the existing sidecar
  `take_screenshot`, POSTs it to the new route in `describe` mode, returns
  just the text description.
- `findUiElement(target)` — same capture, `locate` mode, parses the JSON
  response and returns `{found, x, y, label, confidence}`. **Never clicks
  anything itself** — the model is instructed (system prompt below) to
  follow up with the existing `move_mouse` + `click_mouse` tools, which
  already require the app's normal confirmation prompt. That confirmation
  step *is* the "verify before clicking" safety check the previous pass's
  notes flagged as still needed, reusing what already existed rather than
  building a second one.

**electron/security/riskPolicy.ts**
- `read_screen` / `find_ui_element` = low (both read-only; `find_ui_element`
  returns coordinates but performs no action).

**electron/tools/registry.ts, src/lib/liveSession.ts**
- Wired into `NODE_HANDLERS` and `OS_TOOL_NAMES`/`summarizeOsTool` the same
  way as every other tool in this project.

**server.ts system instruction**
- Explains the `read_screen` vs. `find_ui_element` → `move_mouse` →
  `click_mouse` flow, tells the model to say plainly (not guess coordinates)
  when `find_ui_element` returns `found: false`, and — matching the pattern
  already set for chat-reading in Pass 2 — tells it to mention once that
  screen vision sends a screenshot to the Gemini API for analysis.

**A privacy trade-off worth knowing about, not just the model:** every
`read_screen` or `find_ui_element` call sends a full screenshot of whatever
is currently on screen to the Gemini API — this was explicitly flagged as a
pending decision in the desktop-app README before this pass, and that
decision is now made: it happens automatically, gated only by risk-tier
`low` (no confirmation prompt), same as `take_screenshot` already was. If
you'd rather this required a confirmation the first time per session, or
per app-in-focus, that's a `riskPolicy.ts` change, not a rewrite.

**A pre-existing gap this pass doesn't fix:** in a packaged (production)
build, Electron's main process loads the built UI directly from disk
(`electron/main/index.ts`) and never spawns `server.ts`/`dist/server.cjs` —
so `http://localhost:3000` (both this new route and the existing Live WS
endpoint the voice session already depends on) isn't actually running
unless something else starts it. That gap predates this pass and affects
the Live voice session too, not just screen vision; worth a decision (spawn
the server as a child process from `electron/main/index.ts` on startup is
the natural fix) before you build an installer.

**What I verified**
- Brace/paren balance check across every edited file (no `tsc` available in
  this sandbox — Electron/`@google/genai` aren't installed here). Traced
  the same declaration → `OS_TOOL_NAMES` → `executeTool` → `NODE_HANDLERS`
  → implementation → `server.ts` route path as the previous two passes.
  **Please run `npx tsc --noEmit` on Windows before trusting this compiles
  cleanly** — I could not run it myself this time.

## Pass 6 — Periodic screen awareness (scoped down from "continuous")

The full ask for this pass was a JARVIS-grade "Ultimate Autonomous Mode":
always-on screen understanding, a 10-agent internal architecture, autonomous
monitoring of stocks/news/APIs, self-healing automation, enterprise SaaS
integrations (Slack/Teams/Jira/Confluence/GitHub/GitLab/Google Workspace/
Microsoft 365/CRMs), meeting transcription, knowledge graphs, and more. That
spans several genuinely separate products — most need their own OAuth app
registrations and credentials, several are architecturally different from
"do a thing when the user asks," and none of it belongs jammed into one
pass. What actually shipped here is the one piece explicitly agreed on:
periodic (not continuous, not realtime) screen awareness.

**How it works**
- `electron/main/screenAwareness.ts` runs a timer loop
  (`screenAwarenessIntervalSec`, default 25s) that, on each tick, grabs a
  screenshot via the sidecar and compares a cheap on-device hash against the
  previous tick's hash. If nothing meaningfully changed, it stops there —
  no API call, no cost, no extra screenshot leaving the machine.
- Only when the hash says something changed does it POST to
  `server.ts`'s `/api/vision/analyze-screen` in a new `"ambient"` mode,
  which asks Gemini for a one-line summary plus a `notable` flag (new
  error/permission/security/login dialog — not routine typing, scrolling,
  or a different app coming into focus).
- The result is cached; `get_screen_context` (new tool, LOW risk, no fresh
  capture) lets the model answer "has anything happened on screen" instantly
  using that cache.
- A `notable: true` result sends a passive IPC event to the renderer
  (`ScreenAwarenessNotice.tsx`) — a dismissible banner, nothing more.
  Lumo does **not** bring this up in the live voice conversation on its
  own initiative; the user has to ask. That's a deliberate choice, not a
  missing feature — an assistant that starts narrating what it silently
  noticed on your screen is a different (and much more invasive) product
  than what section 1 of the original spec was probably imagining.

**python-sidecar/sidecar.py**
- `h_take_screenshot` now also returns a `hash` field: a 64-bit
  average-hash from 64 sampled pixel points (not a full-image scan), added
  with zero new dependencies. This is the change-detection signal above.

**electron/security/settings.ts**
- `screenAwarenessEnabled` (default **false**) and
  `screenAwarenessIntervalSec` (default `25`).

**Why this is opt-in only, and only from the Settings modal or tray menu**
This is the one feature in the whole app that sends a screenshot to an
external API on a timer, with no per-call user action. Every other vision
tool (`read_screen`, `find_ui_element`) fires because the user just asked
for it. To keep that same "the user caused this" property for something
that otherwise wouldn't have it, turning screen awareness on is deliberately
**not** exposed as something the model can do via a voice command — only a
toggle in Settings or the tray "Screen Awareness" checkbox can turn it on.
`get_screen_context` (reading the cache) is fine as a normal LOW-risk tool
either way, since it can only ever return what a human already turned on.

**A privacy trade-off worth stating plainly, same as Pass 3's for
`read_screen`:** when this is on, screenshots of whatever is currently on
screen are sent to the Gemini API periodically, independent of anything the
user typed or said in that moment. The interval-plus-hash-diff design keeps
this to "roughly every N seconds, only when something changed" rather than
continuous, but it is still background, not on-demand. The Settings toggle
copy says this outright.

**What I did not build, and why:** true continuous/realtime observation
(sub-second latency, full UI-element trees, OCR of every visible string) —
that's a fundamentally different capture pipeline (likely a persistent
low-level hook rather than periodic `mss` grabs) with real CPU/battery cost,
and multiplies the Gemini Vision API bill by however many times faster than
once-per-25s you want it. If you want that trade explicitly, it's a
`screenAwarenessIntervalSec` change plus swapping the hash-gate for
something less conservative — not a rewrite — but I'd rather you choose that
cost/latency trade-off deliberately than have it silently baked in.

**What I verified:** same caveat as every previous pass — no `tsc`/Electron
runtime available in this sandbox, so this is traced by hand (declaration →
`OS_TOOL_NAMES` → risk tier → `NODE_HANDLERS` → implementation → server.ts
route → IPC → preload → renderer state), not compiled or run.
**Please run `npx tsc --noEmit` on Windows before trusting this compiles.**

## Pass 8 — Screen/chat-aware compose assistant

The ask was "read the screen/a chat and write me a reply" — quote a job
posting in an email, reply to a WhatsApp message, type a drafted answer
into whatever field is focused. **There is no new drafting engine here.**
The Gemini Live model already writes conversational text every turn and
already calls `prepare_email_message`/`prepare_whatsapp_message`/
`prepare_telegram_message` with a body it composes itself — a separate
"compose service" would just duplicate that. What was actually missing
were two small, real gaps, both closed below.

**Gap 1 — `read_screen` summarizes, it doesn't quote (`extract_screen_text`)**
- `server.ts` — new `"extract"` mode on the existing `/api/vision/analyze-screen`
  route. Prompts Gemini Vision to transcribe visible text verbatim (reading
  order, foreground window first, no summarizing/no markdown fences)
  instead of describing it. Output is capped at `EXTRACT_TEXT_CHAR_CAP`
  (3000 chars): the prompt itself asks the model to stop around that
  budget, and the route also truncates server-side and sets
  `truncated: true` in the response, since a prompt is a request, not a
  hard limit — this keeps a verbose response from silently ballooning the
  tool result (and therefore the Live session's context).
- `electron/tools/nodeTools.ts` — `extractScreenText()`, same
  `captureScreenshotBase64()` + `callVisionApi()` helpers `readScreen`/
  `findUiElement` already used, with `mode: 'extract'`. Surfaces the
  `truncated` flag as a plain-language note in the tool result rather than
  silently dropping it.
- New tool `extract_screen_text` — **low** risk, same tier as `read_screen`
  (still read-only; it just returns more of what it reads).

**Gap 2 — no instruction telling the model it could deliver a draft**
`type_text` (sidecar, medium risk, confirms unless Trusted Mode) already
types a string into whatever has focus — it needed no code change, just
permission in the system instruction to use it for a composed draft, not
just short commands. That's handled entirely in the new system-instruction
bullet below; `prepare_email_message`, `prepare_whatsapp_message`,
`prepare_telegram_message`, `send_prepared_message`, and `type_text` are
all untouched by this pass.

**server.ts system instruction** — one new bullet ("Composing from
context"), covering:
1. Which read tool to combine with a compose request — `read_whatsapp_chat`/
   `read_telegram_chat` for "reply to what they just sent"; `read_screen`
   by default for screen-sourced drafts, `extract_screen_text` only when
   exact wording actually matters (it returns more tokens than the
   summary).
2. Honor an explicit tone/length; default to a brief, plain, professional
   draft rather than inventing a personality when none is given.
3. `type_text` is explicitly named as the way to fill a field or type into
   an open document, not just for short commands.
4. Read the drafted text back (or a close paraphrase if long) and get the
   user's OK before calling `send_prepared_message` or `type_text` with it
   — stated explicitly as *in addition to*, not instead of, the app's own
   confirmation prompt.
5. Ask which destination (email / WhatsApp / focused window) when it isn't
   obvious from the request, rather than guessing.
6. Refuse to source a draft from screen content that looks like a
   password, 2FA code, or card number — say so plainly instead of quietly
   working around it, matching the disclosure pattern Pass 2 set for
   chat-reading.

**Wiring checklist for `extract_screen_text`** (declaration →
`OS_TOOL_NAMES` → risk tier → `NODE_HANDLERS` → implementation → route) —
traced by hand and confirmed present in `server.ts` (both the tool
declaration and the `"extract"` route branch), `electron/security/
riskPolicy.ts`, `electron/tools/registry.ts`, `src/lib/liveSession.ts`
(`OS_TOOL_NAMES` + `summarizeOsTool`), and `electron/tools/nodeTools.ts`.

**What I verified — different from every previous pass's notes:** this
sandbox had npm registry access, so I actually ran `npm install` (613
packages, ~20s) and `npx tsc --noEmit` — both against the untouched
codebase first (clean baseline, zero errors) and again after every change
in this pass (still zero errors). Previous passes' notes all say `tsc`
wasn't available and relied on a manual brace/paren trace instead; this
one is an actual clean compile, not just a hand-trace.

**What I could not verify:** there's no Windows display, no real screen
content, and no `GEMINI_API_KEY` in this sandbox, so I could not smoke-test
either gap against a live screenshot or a live Gemini Vision response —
only that the code compiles and the wiring is complete. Please try both
cases from the master prompt once it's running: a screen with a specific
chunk of text (a job posting, an error dialog) → "write an email
referencing that exactly", and a text field with focus → "type a short,
polite reply into this field for me".

**Non-goals honored, not skipped:** no new compose tool or drafting API
call was added — `extract_screen_text` is a *read* tool, same shape as
`read_screen`; no macro-engine changes (macros stay a fixed, pre-recorded
step list, deliberately not made dynamic); no auto-send — every path here
still ends at `send_prepared_message` or `type_text`, both already
confirm-gated; no OCR beyond the local `take_screenshot` the sidecar
already captures.

## Try it

```
npm install
npm run electron:dev
```

Example commands once running: "Open Chrome and search YouTube for Arijit
Singh", "Chrome kholo", "Set volume to 40 percent", "Take a screenshot",
"Move VS Code to monitor 2", "Prepare a WhatsApp message to +91XXXXXXXXXX
saying I'll call you later" → confirm → "send it", "Create a macro called
Work Mode that opens VS Code, Chrome, and Discord" → later: "Run Work Mode",
"Run ipconfig", "Open Task Manager", "Lock my PC", "Open my WhatsApp chat
with +91XXXXXXXXXX" → "What did they just say?", "Email
priya@example.com and say I'll be 10 minutes late" → confirm → "send it",
"What's on my screen right now?", "What does this error say?", "Click the
Save button" (finds it, then asks you to confirm the click). For screen
awareness: turn it on in Settings first, then try "Has anything happened on
my screen?" or "Is Screen Awareness on?". For the compose assistant: with a
job posting or error dialog on screen, try "Read what's on my screen and
draft a reply email" (watch for `extract_screen_text` being called instead
of `read_screen` when wording needs to be exact); with a WhatsApp chat open,
"Read that chat and write a short, casual reply" → confirm the read-back →
"send it"; with a text box focused, "Type a polite decline into this field
for me".

## Pass 10 — Browser automation (click/type on web pages)

**What shipped:** a new `electron/main/webAutomation.ts`, generalizing
`chatWindows.ts`'s pattern (a single, shared, VISIBLE `BrowserWindow`, own
partition `persist:anushka-browser`, same security posture, driven via
`webContents.executeJavaScript()` with small fixed scripts) to arbitrary
pages instead of just WhatsApp/Telegram. Six new tools: `open_web_page`
(low), `read_web_page` (low, read-only DOM text capped at 3000 chars —
reusing the exact char-budget pattern `EXTRACT_TEXT_CHAR_CAP` already set
in `server.ts` for `extract_screen_text`), `find_web_element` (low,
extracts a bounded list of ≤40 visible clickable/typeable elements and
fuzzy-matches against a description — same "return found:false rather than
guess" contract as `find_ui_element`), `click_web_element` (medium),
`type_into_web_field` (medium, reuses `chatWindows.ts`'s proven
`execCommand('insertText')` → `InputEvent` fallback for React-controlled
inputs), and `close_web_page` (low).

**The safety mechanism, honored as specified:** the model never sees or
supplies a CSS selector. It only ever picks an `index` out of a list
Lumo herself just extracted via `find_web_element`/`read_web_page`.
`click_web_element`/`type_into_web_field` both re-run that exact same
extraction (same selector, same visibility filter, same ordering) and
re-locate by index *immediately before acting*, rather than trusting a
stale index from an earlier call — the page may have changed between
"find" and "act".

**The risk-tier judgment call (flagged, not silently decided):**
`click_web_element`/`type_into_web_field` shipped at `medium`, consistent
with `click_mouse`/`type_text`. This is bypassable in Trusted Mode
(the app's default), and a "Buy Now" / "Confirm Order" / "Pay" click on an
arbitrary site carries real financial risk a generic medium tier may
undersell — unlike WhatsApp/Telegram, this now runs against *any* site the
model is told to visit. Recommendation for whoever reviews this: consider
a future pass adding a keyword escalation (element `label` matching
`/buy|pay|purchase|checkout|confirm order/i` forces `high` regardless of
Trusted Mode) as defense in depth. Not shipped in this pass — flagging it
here rather than deciding it silently, per the master prompt.

**Files touched:** new `electron/main/webAutomation.ts`; additions to
`electron/tools/nodeTools.ts` (six thin wrappers), `electron/tools/
registry.ts` (`NODE_HANDLERS`), `electron/security/riskPolicy.ts` (risk
tiers), `src/lib/liveSession.ts` (`OS_TOOL_NAMES` + `summarizeOsTool`),
`server.ts` (six tool declarations + one system-instruction bullet
explaining the read-before-click/type flow, stale-index re-checking, when
to prefer this over `read_screen`/`extract_screen_text`, and the
separate-browser-profile disclosure).

**Explicit non-goals honored:** no headless mode (window is always
visible/shown/focused); no CAPTCHA/anti-bot bypass anywhere in
`webAutomation.ts`; no reuse of the user's real browser's cookies, saved
passwords, or extensions (dedicated `persist:anushka-browser` partition);
no Puppeteer/Playwright dependency — everything is Electron's own
`BrowserWindow` + `executeJavaScript()`, same as `chatWindows.ts`.

**What I verified:** traced all six tools through the full
declaration → `OS_TOOL_NAMES` → risk tier → `NODE_HANDLERS` →
implementation → `executeJavaScript()` wiring checklist by hand.

**What I could not verify:** this sandbox has no display and no outbound
network access (egress is disabled), so I could not actually open a real
page (e.g. a public contact/search form) and watch `find_web_element` /
`click_web_element` / `type_into_web_field` operate against it end-to-end,
and could not run `npm install`/`npx tsc --noEmit` against a real
`node_modules` (no `electron`/`@types/node` packages installed in this
sandbox — the same class of "Cannot find module 'electron'" errors shows
up on every pre-existing file too, e.g. `chatWindows.ts`, confirming it's
an environment gap, not something introduced here). Please run
`npm install && npx tsc --noEmit` for a real compile check, and try: "Open
example.com and read the page for me", "Fill in the contact form on this
page with [details] and find the submit button" → confirm → "click it".

## Pass 11 — Scheduled / timed automation

**What shipped:** a new `electron/main/scheduler.ts` — persisted
`scheduledTasks.json` (own file, next to `macros.json`/`settings.json`,
not bolted onto `settings.ts`), a `setInterval`-based tick loop (~30s,
copying `screenAwareness.ts`'s "cheap check, only act when due" shape)
started from `electron/main/index.ts` the same way
`startScreenAwarenessLoop` is, and three tools: `create_scheduled_task`
(medium), `list_scheduled_tasks` (low, read-only), `delete_scheduled_task`
(medium) — mirroring `create_macro`/`list_macros`/`delete_macro`'s
signatures and error style.

**The unattended-confirmation design decision — went with option (a) as
the default:** a due task is checked against `checkPermission()` for
*every* step it would run (resolving a saved macro's steps first if
needed); if every step would `ALLOW` right now (given current Trusted
Mode + each step's own risk tier), the task dispatches through the exact
same `executeTool(win, 'run_macro'|'run_automation', ...)` path a live
voice command uses. If ANY step would need to `CONFIRM` and the task's
`allowUnattendedConfirm` is `false` (the default), the run is **skipped
and logged**, and a passive notice goes to the renderer over a new
`anushka:scheduled-task-notice` IPC channel — same shape as
`screenAwareness.ts`'s `anushka:screen-notable-change`, not a second
notification mechanism. This was chosen over letting a confirmation prompt
hang for 30s and auto-deny at 3am with nobody there — skip-and-log is
honest about what happened; hang-and-silently-fail is not. The per-schedule
`allowUnattendedConfirm: true` opt-in exists for anyone who explicitly
wants a schedule to run through steps that would otherwise ask — set once,
visibly, at creation time; the `server.ts` system-instruction bullet tells
the model to never set it on its own initiative and to name the specific
tradeoff out loud instead.

**Files touched:** new `electron/main/scheduler.ts`; additions to
`electron/tools/nodeTools.ts` (three thin wrappers), `electron/tools/
registry.ts` (`NODE_HANDLERS`), `electron/security/riskPolicy.ts` (risk
tiers), `src/lib/liveSession.ts` (`OS_TOOL_NAMES` + `summarizeOsTool`),
`server.ts` (three tool declarations + one system-instruction bullet on
the structured trigger vocabulary, mandatory read-back/confirmation before
scheduling, and never self-granting `allowUnattendedConfirm`),
`electron/main/index.ts` (`startSchedulerLoop`/`stopSchedulerLoop` wired
into `app.whenReady()`/`before-quit`, same as screen awareness),
`electron/preload/index.ts` + `src/electron.d.ts` (`onScheduledTaskNotice`
bridge method, same shape as `onScreenNotableChange` — no UI banner wired
up yet, that's a small follow-on in `App.tsx`/a new notice component if
wanted, deliberately not done here to keep this pass to the scheduler
itself).

**Explicit non-goals honored:** no cron-string parsing — the structured
trigger vocabulary (`once`/`daily`/`weekly`/`interval`) is intentionally
small; no DST-aware scheduling — `nextRunAt` uses OS local time verbatim
via `Date`, noted here as a known limitation rather than silently getting
it wrong twice a year; no calendar/Windows-notification-center
integration — a "remind me" request should be created as an ad-hoc
`run_automation` step (e.g. `read_screen` or a spoken confirmation via
however the app already surfaces text back to the user), not a new
integration.

**What I verified:** traced `computeNextRunAt` by hand for one `daily`
trigger (e.g. now = 2:00 PM, trigger hour=9/minute=0 → correctly rolls to
9:00 AM *tomorrow*, not today) and one `once` trigger (returns
`atEpochMs` verbatim, and the task sets `enabled:false` after firing so it
never fires twice); traced a task with a step whose tier is `medium` and
`allowUnattendedConfirm:false` through `wouldRunUnattended()` with Trusted
Mode off, confirming it resolves to "skip and log" rather than dispatching
into a 30s hang. Traced the full wiring checklist (declaration →
`OS_TOOL_NAMES` → risk tier → `NODE_HANDLERS` → tick loop → due-task
detection → unattended-confirmation check → `executeTool()` →
`nextRunAt` recompute/disable) by hand.

**What I could not verify:** same environment gaps as Pass 10 — no real
`node_modules`/`tsc` run, and real-time scheduling behavior (letting a
`daily`/`interval` task actually fire on the clock) is inherently hard to
observe without waiting; I reasoned through the trigger math instead, per
the master prompt's own allowance for that. Please run
`npm install && npx tsc --noEmit`, then try: "Every day at 9 AM, run my
Work Mode macro" → confirm the parsed schedule, "Remind me in 10 minutes
to check the oven", "What's scheduled?", "Delete the 9 AM schedule", and
one deliberately-unattended case (schedule something with a medium-risk
step, turn Trusted Mode off, and confirm it skips-and-notifies instead of
hanging when it fires).
