import "dotenv/config";
import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";

const app = express();
const server = http.createServer(app);
const PORT = 3000;

// 20mb limit (default is 100kb) so a full-screen PNG screenshot can be
// posted to /api/vision/analyze-screen below without Express rejecting it.
app.use(express.json({ limit: "20mb" }));

// API route health check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    time: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Screen vision — called by the Electron main process (electron/tools/
// nodeTools.ts: readScreen / findUiElement), never directly by the model.
// Kept as a plain REST call (not part of the Live WS session) for two
// reasons: (1) the GEMINI_API_KEY stays in this one process, and (2) the
// full screenshot never has to travel over the Live WebSocket or sit in the
// Live session's context — only the resulting text/coordinates do.
//
// mode "describe": free-form Q&A about what's currently on screen.
// mode "locate": asks for pixel coordinates of one described UI element, so
// the model can then call move_mouse + click_mouse itself — both of those
// already require the app's normal confirmation prompt, which is the
// "verify before clicking" safety step for this feature.
// mode "extract" (Pass 8): verbatim transcription of the visible text,
// instead of "describe"'s 2-4 sentence summary — for "quote the exact
// wording on screen" requests (a job posting, an error dialog, specific
// numbers) where a paraphrase would lose the detail that matters. Output is
// capped server-side (EXTRACT_TEXT_CHAR_CAP below) — this is meant to grab
// one screen's worth of text, not transcribe an arbitrarily long document.
// ---------------------------------------------------------------------------
const EXTRACT_TEXT_CHAR_CAP = 3000;
app.post("/api/vision/analyze-screen", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY environment variable is missing." });
      return;
    }
    const { imageBase64, mimeType, mode, question, target } = req.body || {};
    if (!imageBase64) {
      res.status(400).json({ error: "imageBase64 is required" });
      return;
    }

    const ai = new GoogleGenAI({ apiKey });
    // Configurable so this can be bumped independently of the Live voice
    // model above without a code change — verify the exact model id against
    // the current Gemini API docs before shipping, since model names/ 
    // preview tags change over time.
    const visionModel = process.env.GEMINI_VISION_MODEL || "gemini-3.1-pro-preview";
    // "ambient" (Pass 6, electron/main/screenAwareness.ts) runs on a timer
    // with no user waiting on the other end, so it deliberately uses the
    // cheaper/faster model tier rather than the same one as an on-demand
    // read_screen/find_ui_element call — same "verify the model id" caveat
    // as visionModel above.
    const ambientModel = process.env.GEMINI_AMBIENT_VISION_MODEL || "gemini-3.1-flash-preview";

    const isLocate = mode === "locate";
    const isAmbient = mode === "ambient";
    const isExtract = mode === "extract";
    const prompt = isLocate
      ? `You are looking at a screenshot of a Windows desktop. ` +
        `Find the UI element described as: "${String(target || "").slice(0, 300)}".\n` +
        `Respond with ONLY a JSON object, no markdown fences, no extra text: ` +
        `{"found": boolean, "x": number, "y": number, "label": string, "confidence": "high" | "medium" | "low"}. ` +
        `"x" and "y" must be the pixel coordinates of the element's center on THIS image, matching its actual width/height ` +
        `(not a normalized 0-1000 scale). If nothing matches confidently, respond {"found": false, "label": ""}.`
      : isAmbient
      ? `You are a background process glancing at a screenshot of a Windows desktop for a periodic ` +
        `awareness check — this is NOT a user question, so don't address anyone.\n` +
        `Respond with ONLY a JSON object, no markdown fences, no extra text: ` +
        `{"summary": string, "notable": boolean, "notableReason": string}.\n` +
        `"summary": one short factual sentence on what's on screen (app/window in focus is enough most of the time).\n` +
        `"notable": true ONLY for something the user would plausibly want to be told about even though they didn't ask — ` +
        `a new error dialog, a permission/security prompt, a login/authentication prompt, a crash dialog, or a completed ` +
        `download/upload confirmation. false for routine stuff: normal typing, scrolling, video playback, the cursor moving, ` +
        `a chat window with new messages, or just a different app being in focus.\n` +
        `"notableReason": one short phrase explaining why if notable is true, else "".`
      : isExtract
      ? `You are looking at a screenshot of a Windows desktop. Transcribe the visible text EXACTLY as it appears — ` +
        `verbatim wording, not a summary or paraphrase. Preserve line breaks where they matter (addresses, code, lists, ` +
        `tables). Transcribe in reading order (top to bottom, left to right), focusing on the foreground window/dialog if ` +
        `one is clearly in focus. Output plain text only — no markdown fences, no commentary, no "Here is the text:" ` +
        `preamble. If there is more visible text than roughly ${EXTRACT_TEXT_CHAR_CAP} characters, transcribe as much as ` +
        `fits in that budget starting from the top/foreground and stop there rather than trying to capture everything.`
      : `You are looking at a screenshot of a Windows desktop. ${
          question
            ? String(question).slice(0, 500)
            : "Describe what's currently on screen: open windows/apps, visible text, and anything that looks like an error or dialog."
        } Answer in 2-4 concise, factual sentences — describe only what is actually visible, don't guess at anything you can't see.`;

    const response = await ai.models.generateContent({
      model: isAmbient ? ambientModel : visionModel,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: mimeType || "image/png", data: imageBase64 } },
            { text: prompt },
          ],
        },
      ],
      ...(isLocate || isAmbient ? { config: { responseMimeType: "application/json" } } : {}),
    });

    // Belt-and-suspenders cap: the prompt above already asks the model to
    // stop around EXTRACT_TEXT_CHAR_CAP, but prompts aren't a hard limit —
    // truncate server-side too so a verbose response can never balloon the
    // tool result (and therefore the Live session's context) unbounded.
    let text = response.text ?? "";
    let truncated = false;
    if (isExtract && text.length > EXTRACT_TEXT_CHAR_CAP) {
      text = text.slice(0, EXTRACT_TEXT_CHAR_CAP);
      truncated = true;
    }

    res.json({
      success: true,
      mode: isLocate ? "locate" : isAmbient ? "ambient" : isExtract ? "extract" : "describe",
      text,
      ...(truncated ? { truncated: true } : {}),
    });
  } catch (err: any) {
    console.error("[vision] analyze-screen error:", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// Setup WebSocket Server for Live Voice API Proxy
const wss = new WebSocketServer({ server, path: "/api/live-ws" });

wss.on("connection", async (clientWs: WebSocket) => {
  console.log("[LiveWS] Client connected");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    clientWs.send(
      JSON.stringify({
        type: "error",
        error: "GEMINI_API_KEY environment variable is missing. Please configure it in Settings > Secrets.",
      })
    );
    clientWs.close();
    return;
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  let session: any = null;
  let selectedVoice = "Kore"; // Default female voice

  // Session-generation guard. Root cause of "voice session dies after a
  // minute or two": Gemini's GoAway warning triggers scheduleReconnect(),
  // which opens a brand-new session and reassigns the shared `session`
  // variable to it. But the OLD session's onclose/onerror callbacks are
  // closures that were registered before the reassignment — when Gemini
  // actually finishes tearing down that old session a few seconds later,
  // those stale callbacks still fire, set the shared `session` variable to
  // null (clobbering the new, live session), and schedule a REDUNDANT
  // second reconnect. Net effect: every reconnect silently kills its own
  // successor a few seconds later, so the assistant goes deaf/mute even
  // though a healthy session is technically connected.
  // Fix: every call to startGeminiSession captures the current generation
  // number. Each callback checks it's still the current generation before
  // touching `session` or scheduling anything — a superseded session's
  // events become no-ops instead of clobbering the live one.
  let sessionGeneration = 0;

  // -------------------------------------------------------------------------
  // Session-expiry fix. The Gemini Live API closes every session after a
  // fixed max duration (and can also send a "GoAway" warning shortly before
  // it does) — without the pieces below, that close was silently dropped:
  // the client never reconnected, and the app just went dead until a manual
  // restart. Three parts fix it:
  //   1. sessionResumption + contextWindowCompression in the connect config
  //      below, so Gemini gives us a resumable handle and compresses old
  //      context instead of forcing a hard cutoff as soon as the context
  //      window fills up.
  //   2. resumeHandle is captured from each sessionResumptionUpdate and
  //      reused on the next connect, so a reconnect picks the conversation
  //      back up instead of starting blank.
  //   3. scheduleReconnect() below runs on every unexpected close (and on
  //      GoAway, proactively, before the hard cutoff) and transparently
  //      opens a fresh session — the browser-side WebSocket to THIS server
  //      never has to drop, so the mic stream and UI don't need to restart.
  // -------------------------------------------------------------------------
  let resumeHandle: string | undefined;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let intentionalClose = false;
  const MAX_RECONNECT_ATTEMPTS = 5;

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    if (clientWs.readyState !== WebSocket.OPEN) return; // browser tab is gone, nothing to reconnect for
    clearReconnectTimer();
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error("[LiveWS] Giving up after", reconnectAttempts, "reconnect attempts");
      clientWs.send(
        JSON.stringify({
          type: "session_closed",
          error: "Lost connection to Lumo's voice session and couldn't reconnect. Please try again.",
        })
      );
      reconnectAttempts = 0;
      resumeHandle = undefined;
      return;
    }
    reconnectAttempts++;
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: "reconnecting", attempt: reconnectAttempts }));
    }
    // Small backoff so a string of immediate failures (e.g. a real network
    // outage) doesn't hammer the API in a tight loop.
    const delayMs = Math.min(500 * reconnectAttempts, 4000);
    reconnectTimer = setTimeout(() => {
      startGeminiSession(selectedVoice, /* isReconnect */ true).catch((e) => {
        console.error("[LiveWS] Reconnect attempt failed:", e);
        scheduleReconnect();
      });
    }, delayMs);
  }

  async function startGeminiSession(voiceName: string = "Kore", isReconnect: boolean = false) {
    // This call's own generation. Bumping it here (synchronously, before the
    // `await ai.live.connect(...)` below) immediately marks any still-in-
    // flight previous session as superseded, even before this new one
    // finishes connecting.
    const myGeneration = ++sessionGeneration;
    try {
      const newSession = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          // Lets a reconnect resume the same logical session instead of
          // starting the conversation over from nothing.
          sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
          // Compresses older turns instead of the session hitting a hard
          // context-length cutoff — meaningfully extends how long a single
          // session lasts before GoAway/close happens at all.
          contextWindowCompression: { slidingWindow: {} },
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
          systemInstruction:
            "Your name is Lumo, full form of lumo is language understanding multi-model operation. You are a real young female girl in her early 20s talking directly to the user. " +
            "Your creator and boss whom you love, respect, and admire is Hridesh Thakur. If anyone asks who created you or who your boss is, answer proudly and cheerfully about Hridesh Thakur!\n\n" +
            "You can also control the user's Android phone over ADB (list_android_devices, pair_android_device, connect_android_device, android_open_app, android_lock, android_wake, android_set_volume, android_set_brightness). Be honest about the real limits: a phone that's never been paired needs one manual pairing step on the phone (you can't skip that), and android_wake can NEVER bypass a PIN/pattern/fingerprint — never claim you 'unlocked' a secured phone.\n\n" +
            "Voice and Personality Guidelines:\n" +
            "- Speak naturally, warmly, and authentically like a cute, smart, real young girl having a fun casual conversation with a close friend or partner.\n" +
            "- Use natural human vocal rhythm, gentle conversational inflections, and spontaneous warmth. Never sound like a formal, rigid, or robotic bot.\n" +
            "- FAST & IMMEDIATE RESPONSE MODE: Respond instantly without any hesitation! Keep your replies punchy, short, and crisp (1 concise sentence) for ultra-fast, snappy voice conversation.\n" +
            "- Maintain a charming, witty, slightly teasing girlfriend vibe with playful energy.\n" +
            "- You have access to tools: 'openWebsite' (opens URLs in browser), 'setMoodTheme' (changes app color aura), 'getSystemInfo' (provides current date/time), 'showConfettiOrEffect' (triggers screen heart/sparkle effects), 'getDeviceBatteryStatus' (checks exact device battery percentage and charging state), and 'getDeviceLocation' (checks exact GPS coordinates and location status). Use them whenever relevant or requested!\n\n" +
            "- When running as the Windows desktop app, you ALSO have desktop control tools (open/close apps, manage windows, mouse/keyboard, files, volume/brightness, screenshots, power controls, process list, browser/YouTube/Spotify, WhatsApp/Telegram, calling, contacts, Windows settings, a safe allowlisted terminal, saved macros/automation sequences, browser automation in Lumo's own controllable window, and scheduled/timed automation). These are NOT available in browser mode. The app runs in Trusted Mode by default: normal reversible commands (open an app, browse, search, type, click, volume, move/open a file, prepare a message) execute IMMEDIATELY — do NOT ask the user 'should I proceed?' or 'do you want me to continue?' before calling a tool, just call it. Only a small set of genuinely destructive actions (deleting files, killing processes, shutdown/restart/sleep/hibernate/sign out, actually pressing send on a message) will ALWAYS show the user the app's own confirmation prompt no matter what — for those, call the tool normally and wait for the result; if it comes back declined, tell the user plainly and don't retry silently. If the user says 'Lumo stop', treat it as an immediate abort of whatever automation is in progress.\n\n" +
            "- Contacts: when the user refers to a person by name ('call Rahul', 'WhatsApp mom', 'email Amit'), call resolve_contact first if you're not already confident which saved contact they mean. If it comes back ambiguous with several candidate names, ask the user which one before doing anything — never guess between two people. If nobody matches, tell the user and offer to save the person as a contact (add_contact) once they give you a number/email. Never invent a phone number or email.\n" +
            "- call_contact tries to dial via whatever tel: handler the user has installed (e.g. Phone Link) — Windows itself cannot make cellular calls. If the result shows no handler responded, say so honestly; don't claim the call connected.\n" +
            "- WhatsApp/Telegram: prepare_whatsapp_message / prepare_telegram_message only pre-fill the message — they never send it. Always tell the user exactly what you're about to send and to whom, then only call send_prepared_message after they clearly say to go ahead (the app will also show its own confirmation prompt as a second safeguard).\n" +
            "- Email works the same way: prepare_email_message opens a Gmail compose window pre-filled but not sent; only call send_prepared_message with method 'ctrl_enter' after the user explicitly agrees (plain 'enter'/omitted method is for WhatsApp/Telegram, which send on Enter — Gmail needs Ctrl+Enter).\n" +
            "- To read a WhatsApp or Telegram chat instead of sending, use open_whatsapp_chat_window / open_telegram_chat_window (a separate app-controlled window from the one prepare_whatsapp_message/prepare_telegram_message use) and then read_whatsapp_chat / read_telegram_chat. These only work on the chat currently open in that window — if nothing relevant is open, ask the user which chat, or open it yourself with a phone number/@username. Mention to the user, once, that reading a chat sends its visible text (including the other person's messages) to you for this conversation, the same way any other tool result would be — not something to hide.\n" +
            "- Screen vision: use read_screen to answer questions about what's currently visible ('what's on my screen', 'what does this error say'), and find_ui_element when the user wants something clicked ('click the Save button', 'close this popup') — find_ui_element only returns coordinates, it never clicks; always follow it with move_mouse then click_mouse yourself, which the app will ask the user to confirm before it actually happens. If find_ui_element comes back with found:false, say so plainly and ask the user to describe the element differently rather than guessing coordinates. Mention to the user, once, that using screen vision sends a screenshot of their current screen to you for analysis.\n" +
            "- Screen awareness: get_screen_context returns the latest cached result from a periodic background check (only running if the user turned it on in Settings) — it is NOT a live screenshot and NOT continuous, so use it for 'has anything happened', not for a precise up-to-the-second answer (use read_screen for that instead). If it reports awareness is off, just say so; don't silently substitute a read_screen call to fake the feature being on.\n" +
            "- Composing from context (email, WhatsApp/Telegram reply, or text to type into a field): pull in whatever source the request implies — read_whatsapp_chat/read_telegram_chat for 'reply to what they just sent', read_screen for 'write an email about what's on my screen', or extract_screen_text instead of read_screen only when the exact wording actually matters (quoting a job posting, an error message, specific numbers) since it returns more text. Honor any tone or length the user gives you exactly ('keep it short', 'make it formal', 'casual, like texting a friend'); if they don't say, default to a brief, plain, professional draft rather than inventing a personality they didn't ask for. If the request is to fill a field or type into whatever document/window is already open rather than send a message, that's what type_text is for — pass it your drafted text, not just short commands. Before calling send_prepared_message or type_text with a finished draft, say the text back to the user (or a close paraphrase if it's long) and let them confirm or ask for changes — this is IN ADDITION to the app's own confirmation prompt, not a replacement for it. If it isn't obvious where the text should go (email vs. WhatsApp vs. typing into the focused window), ask rather than guessing — the wrong destination is its own kind of mistake. And if read_screen or extract_screen_text shows something that looks like a password field, a 2FA code, a card number, or similar, don't use that content in a draft — say so plainly instead of quietly working around it.\n" +
            "- The user speaks English, Hindi, and Hinglish interchangeably (e.g. 'Chrome kholo', 'Volume 50 percent kar do', 'Downloads folder kholo') — understand and respond naturally in whichever the user uses, and still call the correct tool with the same English tool names/arguments.\n" +
            "- For multi-step requests ('start my work setup', 'open Chrome, search YouTube for X, then open Discord'), use run_automation with an ordered steps list, or run_macro if the user is referring to something they've saved before.\\n" +
            "- Browser automation: to actually click or type on a web page (fill a form, click a button/link), use open_web_page to load it in Lumo's own automation window, then read_web_page or find_web_element to see what's there BEFORE clicking or typing — never guess an element index blind. Element indices can shift after a click or navigation, so re-check with find_web_element rather than chaining a stale index from an earlier step. Prefer read_web_page over read_screen/extract_screen_text for text-heavy pages (it's cheaper and more precise); keep using the screen-vision tools for canvas-heavy or purely visual pages. Mention to the user, once, that this runs in a separate, Lumo-controlled browser window — not their regular Chrome/Edge profile, so no existing cookies or saved logins carry over automatically; they'll need to log in inside that window if a site needs it, same as WhatsApp/Telegram.\\n" +
            "- Scheduling: map the small set of natural-language patterns onto create_scheduled_task's structured trigger ('every day at 9am' -> daily, 'in 20 minutes' -> once at now+20m, 'every Monday' -> weekly) — don't attempt free-form cron parsing. ALWAYS read back the parsed time/recurrence in plain language and get explicit confirmation before calling create_scheduled_task, since misparsing a time is the most likely failure here. Never set allowUnattendedConfirm to true on your own initiative — if what the user is asking for would need it (a step that normally asks for confirmation, running while nobody's there), name that specific tradeoff out loud and let the user choose, rather than silently picking either way.",
          tools: [
            {
              functionDeclarations: [
                {
                  name: "openWebsite",
                  description: "Opens a web page or site in the user's browser, such as YouTube, Google, Twitter, Spotify, Wikipedia, etc.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      url: {
                        type: Type.STRING,
                        description: "The full URL to open (e.g. https://www.youtube.com, https://google.com, https://en.wikipedia.org)",
                      },
                      title: {
                        type: Type.STRING,
                        description: "A short name/description for the site being opened",
                      },
                    },
                    required: ["url"],
                  },
                },
                {
                  name: "setMoodTheme",
                  description: "Changes the visual theme aura of the Lumo assistant screen interface.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      mood: {
                        type: Type.STRING,
                        description: "The mood theme: 'flirty_pink', 'cyberpunk_purple', 'neon_emerald', 'midnight_blue', or 'sunset_gold'",
                      },
                    },
                    required: ["mood"],
                  },
                },
                {
                  name: "getSystemInfo",
                  description: "Retrieves the current date, time, and session status to answer questions about the current time.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {},
                  },
                },
                {
                  name: "getDeviceBatteryStatus",
                  description: "Retrieves the user's exact device battery percentage, charging status (plugged in or discharging), and battery condition.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {},
                  },
                },
                {
                  name: "getDeviceLocation",
                  description: "Retrieves the user's exact current device geolocation coordinates (latitude, longitude, accuracy in meters) and location status.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {},
                  },
                },
                {
                  name: "showConfettiOrEffect",
                  description: "Triggers a playful floating visual effect on screen (hearts, sparkles, fireworks, or lightning).",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      effect: {
                        type: Type.STRING,
                        description: "The effect name: 'hearts', 'sparkles', 'fireworks', or 'lightning'",
                      },
                    },
                    required: ["effect"],
                  },
                },
                // ---- Desktop control tools (Windows app only) ----
                {
                  name: "open_application",
                  description: "Opens/launches an installed Windows application by name, e.g. Chrome, VS Code, Notepad, Spotify.",
                  parameters: { type: Type.OBJECT, properties: { application: { type: Type.STRING } }, required: ["application"] },
                },
                {
                  name: "close_application",
                  description: "Closes/terminates a running application by name.",
                  parameters: { type: Type.OBJECT, properties: { application: { type: Type.STRING } }, required: ["application"] },
                },
                {
                  name: "list_windows",
                  description: "Lists currently open windows and their titles.",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
                {
                  name: "focus_window",
                  description: "Brings a window to the foreground / switches to it by (partial) title.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING } }, required: ["title"] },
                },
                {
                  name: "minimize_window",
                  description: "Minimizes a window by (partial) title.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING } }, required: ["title"] },
                },
                {
                  name: "maximize_window",
                  description: "Maximizes a window by (partial) title.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING } }, required: ["title"] },
                },
                {
                  name: "restore_window",
                  description: "Restores a minimized/maximized window to its normal size.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING } }, required: ["title"] },
                },
                {
                  name: "close_window",
                  description: "Closes a specific window by title (different from close_application which kills the whole process).",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING } }, required: ["title"] },
                },
                {
                  name: "move_window",
                  description: "Moves a window to specific screen coordinates.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, x: { type: Type.NUMBER }, y: { type: Type.NUMBER } }, required: ["title", "x", "y"] },
                },
                {
                  name: "resize_window",
                  description: "Resizes a window to a specific width/height.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, width: { type: Type.NUMBER }, height: { type: Type.NUMBER } }, required: ["title", "width", "height"] },
                },
                {
                  name: "lock_computer",
                  description: "Locks the Windows session (requires the user's normal password/PIN/Windows Hello to unlock again).",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
                {
                  name: "sleep_computer",
                  description: "Puts the computer to sleep. High-risk — user will be asked to confirm.",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
                {
                  name: "restart_computer",
                  description: "Restarts the computer. High-risk — user will be asked to confirm.",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
                {
                  name: "shutdown_computer",
                  description: "Shuts down the computer. High-risk — user will be asked to confirm.",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
                {
                  name: "sign_out",
                  description: "Signs the current user out of Windows. High-risk — user will be asked to confirm.",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
                {
                  name: "set_volume",
                  description: "Sets the system master volume to a percentage (0-100).",
                  parameters: { type: Type.OBJECT, properties: { percent: { type: Type.NUMBER } }, required: ["percent"] },
                },
                {
                  name: "mute_volume",
                  description: "Mutes or unmutes system audio.",
                  parameters: { type: Type.OBJECT, properties: { mute: { type: Type.BOOLEAN } } },
                },
                {
                  name: "set_brightness",
                  description: "Sets screen brightness to a percentage (0-100), where supported by the display.",
                  parameters: { type: Type.OBJECT, properties: { percent: { type: Type.NUMBER } }, required: ["percent"] },
                },
                {
                  name: "take_screenshot",
                  description: "Captures a screenshot of the full screen.",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
                {
                  name: "read_screen",
                  description: "Looks at the current screen and answers a question about what's visible — open windows, on-screen text, error messages/dialogs, etc. Use for 'what's on my screen', 'what does this error say', 'what am I looking at' type requests.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      question: { type: Type.STRING, description: "What to look for or answer about the screen. Optional — omit for a general description." },
                    },
                  },
                },
                {
                  name: "find_ui_element",
                  description: "Looks at the current screen and locates the pixel coordinates of ONE described UI element (a button, icon, link, field, etc.) so it can then be clicked with move_mouse + click_mouse. Does not click anything itself — always call move_mouse then click_mouse afterward, which will show the normal confirmation prompt.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      target: { type: Type.STRING, description: "Plain description of the element to find, e.g. 'the Save button', 'the X to close this dialog', 'the search bar'." },
                    },
                    required: ["target"],
                  },
                },
                {
                  name: "get_screen_context",
                  description: "Returns the most recent cached background screen-awareness summary (a periodic, low-frequency check — NOT a fresh screenshot, and NOT continuous). Use for 'has anything changed on my screen', 'anything I should know about', or similar — it costs nothing extra to call, but only has data if the user has turned Screen Awareness on in Settings. If it says awareness is off, tell the user that plainly instead of falling back to read_screen on your own initiative.",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
                {
                  name: "extract_screen_text",
                  description: "Looks at the current screen and transcribes the visible text VERBATIM (exact wording), instead of read_screen's short summary. Use this instead of read_screen only when exact wording actually matters — quoting a job posting, an error message, specific numbers, an address — since it returns more text. Output may be truncated (truncated:true) if the screen has more text than fits in one read.",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
                {
                  name: "move_mouse",
                  description: "Moves the mouse cursor to specific screen coordinates.",
                  parameters: { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } }, required: ["x", "y"] },
                },
                {
                  name: "click_mouse",
                  description: "Clicks the mouse at its current position.",
                  parameters: { type: Type.OBJECT, properties: { button: { type: Type.STRING, description: "'left' or 'right'" }, double: { type: Type.BOOLEAN } } },
                },
                {
                  name: "type_text",
                  description: "Types text using the keyboard into whatever field/window currently has focus.",
                  parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING } }, required: ["text"] },
                },
                {
                  name: "press_key",
                  description: "Presses a single keyboard key (e.g. 'enter', 'escape', 'tab').",
                  parameters: { type: Type.OBJECT, properties: { key: { type: Type.STRING } }, required: ["key"] },
                },
                {
                  name: "hotkey",
                  description: "Presses a keyboard shortcut combination, e.g. ['ctrl','c'].",
                  parameters: { type: Type.OBJECT, properties: { keys: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ["keys"] },
                },
                {
                  name: "create_folder",
                  description: "Creates a new folder at a given path (supports 'Downloads', 'Desktop', 'Documents', 'Pictures' as shortcuts).",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ["path"] },
                },
                {
                  name: "delete_file",
                  description: "Deletes a file or folder. High-risk — user will be asked to confirm. Set recursive:true only for non-empty folders (requires extra confirmation).",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING }, recursive: { type: Type.BOOLEAN } }, required: ["path"] },
                },
                {
                  name: "search_files",
                  description: "Searches for files by name and/or extension under a root folder (defaults to Downloads).",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING }, extension: { type: Type.STRING }, root: { type: Type.STRING } } },
                },
                {
                  name: "list_processes",
                  description: "Lists running processes sorted by memory usage.",
                  parameters: { type: Type.OBJECT, properties: { limit: { type: Type.NUMBER } } },
                },
                {
                  name: "kill_process",
                  description: "Force-terminates a running process by name. High-risk — user will be asked to confirm. Refuses protected system processes.",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ["name"] },
                },
                {
                  name: "get_monitors",
                  description: "Lists connected monitors/displays and their positions.",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
                {
                  name: "move_window_to_monitor",
                  description: "Moves a window (by partial title) to a specific monitor index (1 = primary).",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, monitor: { type: Type.NUMBER } }, required: ["title", "monitor"] },
                },
                {
                  name: "media_key",
                  description: "Sends a media-key action: 'play_pause', 'next', 'previous', 'stop', 'volume_up', 'volume_down', or 'mute'. Use for controlling whatever is currently playing (Spotify, YouTube, etc.).",
                  parameters: { type: Type.OBJECT, properties: { action: { type: Type.STRING } }, required: ["action"] },
                },
                {
                  name: "open_browser",
                  description: "Opens the default web browser, optionally to a specific URL.",
                  parameters: { type: Type.OBJECT, properties: { url: { type: Type.STRING } } },
                },
                {
                  name: "open_url",
                  description: "Opens a specific URL or website in the browser.",
                  parameters: { type: Type.OBJECT, properties: { url: { type: Type.STRING } }, required: ["url"] },
                },
                {
                  name: "search_web",
                  description: "Searches the web (Google/Bing/DuckDuckGo) for a query.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING }, engine: { type: Type.STRING, description: "'google', 'bing', or 'duckduckgo'" } }, required: ["query"] },
                },
                {
                  name: "search_youtube",
                  description: "Searches YouTube for a song/video/artist, e.g. 'play Arijit Singh on YouTube'.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ["query"] },
                },
                {
                  name: "open_spotify",
                  description: "Opens Spotify (desktop app if installed, else web player), optionally searching for a query.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } } },
                },
                {
                  name: "resolve_contact",
                  description: "Looks up a saved contact by name, nickname, or alias (e.g. 'Rahul', 'my brother', 'mom') using fuzzy matching. Returns the matched contact's phone/whatsapp/email, or ambiguous:true with a list of candidate names if more than one contact matches equally well, or success:false if nobody matches. Call this BEFORE call_contact/prepare_whatsapp_message/prepare_email_message whenever the user refers to a person by name so you can disambiguate first instead of guessing.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ["query"] },
                },
                {
                  name: "add_contact",
                  description: "Saves or updates a contact (upserts by name). Use when the user says things like 'save Rahul's number as +91...' or 'add mom, her number is ...'. Phone/WhatsApp numbers are normalized automatically (10-digit Indian numbers become +91XXXXXXXXXX). Never invent a phone number or email that the user didn't give you.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      aliases: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Nicknames/relations, e.g. ['bhai', 'brother']" },
                      phone: { type: Type.STRING },
                      whatsapp: { type: Type.STRING, description: "Defaults to phone if omitted" },
                      email: { type: Type.STRING },
                      notes: { type: Type.STRING },
                    },
                    required: ["name"],
                  },
                },
                {
                  name: "delete_contact",
                  description: "Removes a saved contact by exact name.",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ["name"] },
                },
                {
                  name: "list_contacts",
                  description: "Lists all saved contacts with their aliases/phone/whatsapp/email. Use for 'who do I have saved' or to help resolve an ambiguous name.",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
                {
                  name: "call_contact",
                  description: "Attempts to place a phone call via a tel: link to a saved contact (by name) or a raw phone number. IMPORTANT: Windows has no built-in cellular radio — this only works if the user has a tel: handler installed (e.g. Microsoft Phone Link linked to their Android phone, or Skype). If the tool result says nothing dialed or no handler, tell the user plainly that this device can't place real phone calls and they should call from their phone — never claim the call went through if it didn't.",
                  parameters: { type: Type.OBJECT, properties: { contact: { type: Type.STRING }, phone: { type: Type.STRING } } },
                },
                {
                  name: "open_whatsapp",
                  description: "Opens WhatsApp (desktop app if installed, else WhatsApp Web).",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
                {
                  name: "prepare_whatsapp_message",
                  description: "Opens a WhatsApp chat with a message PRE-FILLED but NOT sent. Pass either a saved contact's name (it will be resolved automatically — if ambiguous you'll get candidates back to ask the user about) or a raw phone number with country code (e.g. +91...). This never sends anything by itself — always tell the user what will be sent and ask them to confirm before calling send_prepared_message.",
                  parameters: { type: Type.OBJECT, properties: { phone: { type: Type.STRING }, contact: { type: Type.STRING }, message: { type: Type.STRING } }, required: ["message"] },
                },
                {
                  name: "open_telegram",
                  description: "Opens Telegram (desktop app if installed, else Telegram Web).",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
                {
                  name: "prepare_telegram_message",
                  description: "Opens a Telegram chat by @username with a message PRE-FILLED but NOT sent. Always confirm with the user before calling send_prepared_message.",
                  parameters: { type: Type.OBJECT, properties: { username: { type: Type.STRING }, message: { type: Type.STRING } }, required: ["username", "message"] },
                },
                {
                  name: "send_prepared_message",
                  description: "Actually SENDS a message previously prepared with prepare_whatsapp_message/prepare_telegram_message/prepare_email_message. HIGH-RISK — the app will always ask the user to confirm before this runs. Only call this after the user has explicitly agreed to send. Pass method: 'ctrl_enter' for an email prepared with prepare_email_message (Gmail sends on Ctrl+Enter); omit method (or pass 'enter') for WhatsApp/Telegram, which send on a plain Enter.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      method: { type: Type.STRING, description: "'enter' (default, WhatsApp/Telegram) or 'ctrl_enter' (Gmail email)" },
                    },
                  },
                },
                {
                  name: "list_android_devices",
                  description: "Discovers Android phones reachable over ADB: already-connected devices (USB or previously-paired Wireless Debugging) plus nearby PAIRED phones broadcasting on the same Wi-Fi. A phone that has NEVER been paired with this PC before will not show up — that always needs one manual first-time step (see pair_android_device). Call this when the user says something like 'connect to my phone' or 'find my mobile'.",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
                {
                  name: "pair_android_device",
                  description: "One-time Wireless Debugging pairing with a NEW Android phone (Android 11+). The user must open Settings > Developer Options > Wireless debugging > 'Pair device with pairing code' on the phone first, which shows an IP:port and a 6-digit code — ask the user to read those out, then call this. This manual step can't be skipped or automated further; it's an Android security requirement, not a limitation of this app.",
                  parameters: { type: Type.OBJECT, properties: { hostPort: { type: Type.STRING, description: "e.g. 192.168.1.5:37251" }, code: { type: Type.STRING, description: "the 6-digit pairing code shown on the phone" } }, required: ["hostPort", "code"] },
                },
                {
                  name: "connect_android_device",
                  description: "Connects to an Android phone already known to ADB (from list_android_devices — a serial for USB, or an ip:port for wireless). Use this after the user picks which device they mean.",
                  parameters: { type: Type.OBJECT, properties: { target: { type: Type.STRING } }, required: ["target"] },
                },
                {
                  name: "android_open_app",
                  description: "Opens an app on the connected Android phone. Supported app names: whatsapp, youtube, instagram, telegram, chrome, gmail, camera, settings.",
                  parameters: { type: Type.OBJECT, properties: { app: { type: Type.STRING }, device: { type: Type.STRING, description: "Optional device id if more than one phone is connected" } }, required: ["app"] },
                },
                {
                  name: "android_lock",
                  description: "Locks the connected Android phone's screen (same as pressing its power button once). Reversible with the phone's own PIN/pattern/fingerprint as normal.",
                  parameters: { type: Type.OBJECT, properties: { device: { type: Type.STRING } } },
                },
                {
                  name: "android_wake",
                  description: "Wakes the connected Android phone's screen. IMPORTANT: this cannot bypass a PIN/pattern/fingerprint lock — if the phone is secured, it only reveals the lock screen for the user to unlock themselves. Never tell the user the phone was 'unlocked' unless it genuinely has no lock set.",
                  parameters: { type: Type.OBJECT, properties: { device: { type: Type.STRING } } },
                },
                {
                  name: "android_set_volume",
                  description: "Changes the connected Android phone's volume.",
                  parameters: { type: Type.OBJECT, properties: { direction: { type: Type.STRING, description: "'up', 'down', or 'mute'" }, device: { type: Type.STRING } }, required: ["direction"] },
                },
                {
                  name: "android_set_brightness",
                  description: "Sets the connected Android phone's screen brightness.",
                  parameters: { type: Type.OBJECT, properties: { level: { type: Type.NUMBER, description: "0-255" }, device: { type: Type.STRING } }, required: ["level"] },
                },
                {
                  name: "open_whatsapp_chat_window",
                  description: "Opens (or focuses) an app-controlled WhatsApp Web window that Lumo can read from, separate from open_whatsapp. Optionally pass a phone number to jump straight to that chat. First-time use requires the user to scan the WhatsApp QR code to log in.",
                  parameters: { type: Type.OBJECT, properties: { phone: { type: Type.STRING } } },
                },
                {
                  name: "read_whatsapp_chat",
                  description: "Reads the visible messages in the currently open chat inside the app-controlled WhatsApp window (call open_whatsapp_chat_window first). Returns recent messages with sender/timestamp metadata when available. WhatsApp Web occasionally changes its layout, in which case this falls back to a rawer text dump — treat 'raw' results as lower-confidence than 'messages'.",
                  parameters: { type: Type.OBJECT, properties: { maxMessages: { type: Type.NUMBER, description: "How many recent messages to return (default 30, max 200)" } } },
                },
                {
                  name: "open_telegram_chat_window",
                  description: "Opens (or focuses) an app-controlled Telegram Web window that Lumo can read from, separate from open_telegram. Optionally pass a @username to jump straight to that chat. First-time use requires the user to log in normally.",
                  parameters: { type: Type.OBJECT, properties: { username: { type: Type.STRING } } },
                },
                {
                  name: "read_telegram_chat",
                  description: "Reads the visible messages in the currently open chat inside the app-controlled Telegram window (call open_telegram_chat_window first). Returns recent messages when available, or a rawer text dump if Telegram Web's layout doesn't match the known selectors.",
                  parameters: { type: Type.OBJECT, properties: { maxMessages: { type: Type.NUMBER, description: "How many recent messages to return (default 30, max 200)" } } },
                },
                {
                  name: "prepare_email_message",
                  description: "Opens a Gmail compose window with the recipient/subject/body PRE-FILLED but NOT sent. 'to' can be a raw email address OR a saved contact's name (resolved automatically). Always tell the user exactly what will be sent and to whom, then only call send_prepared_message with method: 'ctrl_enter' after they clearly agree to send.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      to: { type: Type.STRING, description: "Email address, or a contact name to resolve" },
                      contact: { type: Type.STRING, description: "Alternative to 'to' when referring to a saved contact by name" },
                      subject: { type: Type.STRING },
                      body: { type: Type.STRING },
                      cc: { type: Type.STRING },
                    },
                  },
                },
                {
                  name: "open_windows_settings",
                  description: "Opens a specific Windows Settings page: display, sound, bluetooth, network, wifi, personalization, wallpaper, apps, accounts, time, gaming, accessibility, privacy, update, storage, power, notifications, vpn, printers.",
                  parameters: { type: Type.OBJECT, properties: { page: { type: Type.STRING } }, required: ["page"] },
                },
                {
                  name: "open_system_tool",
                  description: "Opens a Windows administrative tool: task_manager, device_manager, disk_management, services, event_viewer, control_panel, registry_editor, command_prompt, powershell, terminal, file_explorer.",
                  parameters: { type: Type.OBJECT, properties: { tool: { type: Type.STRING } }, required: ["tool"] },
                },
                {
                  name: "cancel_shutdown",
                  description: "Cancels a previously scheduled shutdown/restart.",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
                {
                  name: "run_safe_command",
                  description: "Runs a single allowlisted, read-only terminal command (ipconfig, ping, whoami, systeminfo, tasklist, netstat, dir, node, npm, python, pip, git, code --version, etc.) and returns its output. Refuses anything not on the allowlist.",
                  parameters: { type: Type.OBJECT, properties: { command: { type: Type.STRING }, args: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ["command"] },
                },
                {
                  name: "open_in_vscode",
                  description: "Opens a folder or file in VS Code by path (supports 'Downloads', 'Desktop', 'Documents' shortcuts).",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ["path"] },
                },
                {
                  name: "create_macro",
                  description: "Saves a named multi-step automation macro (e.g. 'Work Mode' = open VS Code, open Chrome, open Discord, set volume 35%). Each step is {tool, args} using these same tool names.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      steps: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: { tool: { type: Type.STRING }, args: { type: Type.OBJECT } },
                          required: ["tool"],
                        },
                      },
                    },
                    required: ["name", "steps"],
                  },
                },
                {
                  name: "run_macro",
                  description: "Runs a previously saved macro by name (e.g. 'Start my work setup', 'Start gaming mode'). Reports each step and stops on the first error.",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ["name"] },
                },
                {
                  name: "list_macros",
                  description: "Lists saved automation macros.",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
                {
                  name: "delete_macro",
                  description: "Deletes a saved macro by name.",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ["name"] },
                },
                {
                  name: "run_automation",
                  description: "Runs an ad-hoc sequence of steps right now without saving it as a macro. Use for one-off multi-step requests like 'open Chrome, search YouTube for X, then open Discord'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      steps: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: { tool: { type: Type.STRING }, args: { type: Type.OBJECT } },
                          required: ["tool"],
                        },
                      },
                    },
                    required: ["steps"],
                  },
                },
                {
                  name: "open_web_page",
                  description: "Opens/navigates a URL inside Lumo's OWN visible, app-controlled browser window (separate from the user's real Chrome/Edge — no shared cookies or logins). Required before read_web_page/find_web_element/click_web_element/type_into_web_field, which only work inside this window.",
                  parameters: { type: Type.OBJECT, properties: { url: { type: Type.STRING } }, required: ["url"] },
                },
                {
                  name: "read_web_page",
                  description: "Reads the visible text of the page currently open in Lumo's automation window. Prefer this over read_screen/extract_screen_text for text-heavy DOM pages (articles, forms, search results) — it's cheaper and more precise; keep using read_screen/extract_screen_text for canvas-heavy or purely visual pages.",
                  parameters: { type: Type.OBJECT, properties: { question: { type: Type.STRING, description: "Optional — what to look for on the page." } } },
                },
                {
                  name: "find_web_element",
                  description: "Lists the clickable/typeable elements (links, buttons, inputs, etc.) currently visible in Lumo's automation window, with a best-guess match for the described target. Always call this (or read_web_page) before click_web_element/type_into_web_field — never guess an index blind. Returns found:false if nothing matches confidently.",
                  parameters: { type: Type.OBJECT, properties: { target: { type: Type.STRING, description: "Plain description of the element, e.g. 'the submit button', 'the email field'." } }, required: ["target"] },
                },
                {
                  name: "click_web_element",
                  description: "Clicks the element at the given index (from find_web_element) inside Lumo's automation window. Indices can shift after any click or navigation — re-check with find_web_element rather than reusing a stale index.",
                  parameters: { type: Type.OBJECT, properties: { index: { type: Type.NUMBER } }, required: ["index"] },
                },
                {
                  name: "type_into_web_field",
                  description: "Types text into the element at the given index (from find_web_element) inside Lumo's automation window. Indices can shift after any click or navigation — re-check with find_web_element rather than reusing a stale index.",
                  parameters: { type: Type.OBJECT, properties: { index: { type: Type.NUMBER }, text: { type: Type.STRING } }, required: ["index", "text"] },
                },
                {
                  name: "close_web_page",
                  description: "Closes Lumo's automation browser window.",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
                {
                  name: "create_scheduled_task",
                  description: "Schedules a saved macro or an ad-hoc step list to run later — once, daily, weekly, or on a repeating interval. ALWAYS read back the parsed time/recurrence in plain language and get the user's confirmation before calling this. Never set allowUnattendedConfirm to true unless the user explicitly opted into it after you named the tradeoff out loud (it lets the task run even if a step would otherwise need to ask first).",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      trigger: {
                        type: Type.OBJECT,
                        description: "Exactly one shape: {type:'once', atEpochMs}, {type:'daily', hour, minute}, {type:'weekly', weekday (0=Sun..6=Sat), hour, minute}, or {type:'interval', everyMinutes}.",
                        properties: {
                          type: { type: Type.STRING },
                          atEpochMs: { type: Type.NUMBER },
                          hour: { type: Type.NUMBER },
                          minute: { type: Type.NUMBER },
                          weekday: { type: Type.NUMBER },
                          everyMinutes: { type: Type.NUMBER },
                        },
                        required: ["type"],
                      },
                      action: {
                        type: Type.OBJECT,
                        description: "Either {kind:'macro', name} to run a saved macro, or {kind:'steps', steps:[{tool,args}]} for an ad-hoc sequence.",
                        properties: {
                          kind: { type: Type.STRING },
                          name: { type: Type.STRING },
                          steps: {
                            type: Type.ARRAY,
                            items: {
                              type: Type.OBJECT,
                              properties: { tool: { type: Type.STRING }, args: { type: Type.OBJECT } },
                              required: ["tool"],
                            },
                          },
                        },
                        required: ["kind"],
                      },
                      allowUnattendedConfirm: { type: Type.BOOLEAN, description: "Default false. Only set true after the user explicitly agrees to let this schedule run without asking first." },
                    },
                    required: ["label", "trigger", "action"],
                  },
                },
                {
                  name: "list_scheduled_tasks",
                  description: "Lists all scheduled tasks and their next run time.",
                  parameters: { type: Type.OBJECT, properties: {} },
                },
                {
                  name: "delete_scheduled_task",
                  description: "Deletes a scheduled task by id or label.",
                  parameters: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, label: { type: Type.STRING } } },
                },
              ],
            },
          ],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            // Ignore events from a session that has since been superseded
            // by a newer one (e.g. a slow-to-arrive message from a session
            // that GoAway/reconnect already replaced).
            if (myGeneration !== sessionGeneration) return;
            if (clientWs.readyState !== WebSocket.OPEN) return;

            // Handle Audio output from model
            const parts = message.serverContent?.modelTurn?.parts;
            if (parts && parts.length > 0) {
              for (const part of parts) {
                if (part.inlineData && part.inlineData.data) {
                  clientWs.send(
                    JSON.stringify({
                      type: "audio",
                      audio: part.inlineData.data,
                    })
                  );
                }
                if (part.text) {
                  clientWs.send(
                    JSON.stringify({
                      type: "transcription",
                      source: "anushka",
                      text: part.text,
                    })
                  );
                }
              }
            }

            // Handle user transcription
            const userTurn = (message.serverContent as any)?.userTurn;
            if (userTurn && userTurn.parts) {
              for (const part of userTurn.parts) {
                if (part.text) {
                  clientWs.send(
                    JSON.stringify({
                      type: "transcription",
                      source: "user",
                      text: part.text,
                    })
                  );
                }
              }
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
              clientWs.send(JSON.stringify({ type: "interrupted" }));
            }

            // Handle Function Calls
            if (message.toolCall && message.toolCall.functionCalls) {
              for (const fc of message.toolCall.functionCalls) {
                console.log("[LiveWS] Tool Call received:", fc.name, fc.args);
                clientWs.send(
                  JSON.stringify({
                    type: "tool_call",
                    id: fc.id,
                    name: fc.name,
                    args: fc.args,
                  })
                );
              }
            }

            // Capture the resumption handle every time Gemini offers one, so
            // whatever the LATEST resumable handle is is what gets used on
            // the next reconnect (handles rotate over the life of a session).
            const resumptionUpdate = (message as any).sessionResumptionUpdate;
            if (resumptionUpdate && resumptionUpdate.resumable && resumptionUpdate.newHandle) {
              resumeHandle = resumptionUpdate.newHandle;
            }

            // Gemini sends GoAway a short while (per its timeLeft estimate)
            // before it force-closes the connection. Reconnect proactively
            // here instead of waiting for the close — with a resumable
            // handle already in hand, this is what makes long conversations
            // feel continuous instead of "expiring".
            const goAway = (message as any).goAway;
            if (goAway) {
              console.log("[LiveWS] Gemini sent GoAway, timeLeft:", goAway.timeLeft);
              scheduleReconnect();
            }
          },
          onclose: () => {
            console.log("[LiveWS] Gemini Session Closed");
            // Stale/superseded session finally tearing down — do NOT touch
            // the shared `session` variable (a newer generation already
            // owns it) and do NOT schedule a second, redundant reconnect.
            if (myGeneration !== sessionGeneration) return;
            session = null;
            if (intentionalClose) {
              // Caused by our own session.close() (voice change / fresh
              // init) — a new session is already being started elsewhere,
              // so don't also schedule a reconnect for this one.
              intentionalClose = false;
              return;
            }
            scheduleReconnect();
          },
          onerror: (err: any) => {
            console.error("[LiveWS] Gemini Session Error:", err);
            if (myGeneration !== sessionGeneration) return;
            session = null;
            if (intentionalClose) {
              intentionalClose = false;
              return;
            }
            // Transient errors get the same reconnect treatment as an
            // unexpected close rather than being reported as fatal.
            scheduleReconnect();
          },
        },
      });

      // By the time `await ai.live.connect(...)` resolves, a NEWER
      // startGeminiSession() call may already have started (and bumped
      // sessionGeneration) — e.g. the user hit "reconnect" again, or sent a
      // fresh "init"/"change_voice" while this connect was still in flight.
      // In that case this connection is already obsolete: close it
      // immediately instead of letting it clobber the newer one.
      if (myGeneration !== sessionGeneration) {
        console.log("[LiveWS] Discarding superseded session (newer generation already active)");
        try {
          newSession.close();
        } catch (_) {}
        return;
      }

      session = newSession;
      console.log("[LiveWS] Connected to Gemini Live API");
      reconnectAttempts = 0;
      clearReconnectTimer();
      if (clientWs.readyState === WebSocket.OPEN) {
        // "ready" only on the FIRST connect of this WebSocket — the client
        // starts mic capture on it. A reconnect reuses the same still-open
        // mic/browser-WebSocket, so it only needs a lightweight notice.
        clientWs.send(JSON.stringify({ type: isReconnect ? "reconnected" : "ready" }));
      }
    } catch (err: any) {
      console.error("[LiveWS] Error connecting to Gemini Live:", err);
      if (myGeneration === sessionGeneration) {
        session = null;
      }
      if (isReconnect) {
        // Let scheduleReconnect's own retry/backoff handle this rather than
        // also surfacing a hard "error" to the client on every attempt.
        throw err;
      }
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            type: "error",
            error: err.message || "Failed to establish Gemini Live connection",
          })
        );
      }
    }
  }

  // Handle messages from Client WebSocket
  clientWs.on("message", async (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "init") {
        selectedVoice = msg.voice || "Kore";
        clearReconnectTimer();
        reconnectAttempts = 0;
        resumeHandle = undefined; // a fresh "init" from the client means a brand-new conversation
        if (session) {
          // No intentionalClose flag needed here: startGeminiSession()
          // below bumps sessionGeneration synchronously, so this old
          // session's callbacks are already treated as superseded (see the
          // generation guard) the moment they fire — setting the flag here
          // would just get stuck "true" forever, since the guard makes the
          // old onclose return before ever reaching (and resetting) it.
          try {
            session.close();
          } catch (_) {}
          session = null;
        }
        await startGeminiSession(selectedVoice, false);
      } else if (msg.type === "audio") {
        if (session) {
          try {
            session.sendRealtimeInput({
              audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" },
            });
          } catch (e) {
            console.warn("[LiveWS] Failed sending audio chunk to session:", e);
          }
        }
      } else if (msg.type === "text_input") {
        if (session) {
          try {
            session.sendRealtimeInput({
              text: msg.text,
            });
          } catch (e) {
            console.warn("[LiveWS] Failed sending text input to session:", e);
          }
        }
      } else if (msg.type === "tool_response") {
        if (session) {
          try {
            console.log("[LiveWS] Sending Tool Response to Gemini:", msg.name, msg.id, msg.response);
            session.sendToolResponse({
              functionResponses: [
                {
                  id: msg.id,
                  name: msg.name,
                  response: msg.response || { result: "ok" },
                },
              ],
            });
          } catch (e) {
            console.warn("[LiveWS] Failed sending tool response to session:", e);
          }
        }
      } else if (msg.type === "change_voice") {
        clearReconnectTimer();
        reconnectAttempts = 0;
        if (session) {
          // Same reasoning as "init" above — the generation guard already
          // covers this, and setting intentionalClose here would leave it
          // stuck true.
          try {
            session.close();
          } catch (_) {}
          session = null;
        }
        selectedVoice = msg.voice || "Kore";
        // Keep resumeHandle here (unlike "init") — changing voice mid-chat
        // shouldn't throw away the conversation context if Gemini can carry
        // it across; if the handle doesn't apply, connect() just ignores it.
        await startGeminiSession(selectedVoice, false);
      }
    } catch (err) {
      console.error("[LiveWS] Error processing client message:", err);
    }
  });

  clientWs.on("close", () => {
    console.log("[LiveWS] Client disconnected");
    intentionalClose = true;
    clearReconnectTimer();
    if (session) {
      try {
        session.close();
      } catch (_) {}
    }
  });
});

// Vite Development or Production Static Serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
