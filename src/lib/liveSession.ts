import { AudioInputManager, AudioOutputManager } from './audioStreamer';
import { SessionState, VoiceName, MoodTheme, ToolCallItem, TranscriptItem } from '../types';

// Names of every desktop-control tool. Kept in sync with the declarations
// added to server.ts's Gemini tool list and the risk tiers in
// electron/security/riskPolicy.ts.
export const OS_TOOL_NAMES = new Set([
  'open_application', 'close_application', 'list_windows', 'focus_window',
  'minimize_window', 'maximize_window', 'restore_window', 'close_window',
  'move_window', 'resize_window',
  'lock_computer', 'sleep_computer', 'hibernate_computer', 'restart_computer',
  'shutdown_computer', 'sign_out',
  'set_volume', 'mute_volume', 'set_brightness',
  'take_screenshot', 'move_mouse', 'click_mouse', 'scroll_mouse',
  'type_text', 'press_key', 'hotkey',
  'read_clipboard', 'write_clipboard', 'clear_clipboard',
  'open_file', 'open_folder', 'create_file', 'create_folder',
  'rename_file', 'copy_file', 'move_file', 'delete_file', 'delete_folder',
  'search_files', 'get_system_info', 'list_processes', 'kill_process',
  'open_browser', 'open_url', 'search_web', 'search_youtube', 'open_spotify',
  'open_whatsapp', 'prepare_whatsapp_message', 'open_telegram', 'prepare_telegram_message',
  'send_prepared_message', 'open_windows_settings', 'open_system_tool', 'cancel_shutdown',
  'run_safe_command', 'open_in_vscode', 'create_macro', 'delete_macro', 'list_macros',
  'run_macro', 'run_automation', 'get_monitors', 'move_window_to_monitor', 'media_key',
  'open_whatsapp_chat_window', 'read_whatsapp_chat', 'open_telegram_chat_window',
  'read_telegram_chat', 'prepare_email_message', 'read_screen', 'find_ui_element',
  'resolve_contact', 'add_contact', 'update_contact', 'delete_contact', 'list_contacts',
  'call_contact', 'get_screen_context', 'extract_screen_text',
  'open_web_page', 'read_web_page', 'find_web_element', 'click_web_element',
  'type_into_web_field', 'close_web_page',
  'create_scheduled_task', 'list_scheduled_tasks', 'delete_scheduled_task',
]);

function summarizeOsTool(name: string, args: Record<string, any>, result: any): string {
  switch (name) {
    case 'open_application': return `Opened ${args.application}`;
    case 'close_application': return `Closed ${args.application}`;
    case 'shutdown_computer': return 'Shutting down';
    case 'restart_computer': return 'Restarting';
    case 'lock_computer': return 'Locked the PC';
    case 'take_screenshot': return 'Captured the screen';
    case 'set_volume': return `Volume set to ${args.percent}%`;
    case 'open_browser': return 'Opened browser';
    case 'search_web': return `Searched the web for "${args.query}"`;
    case 'search_youtube': return `Searched YouTube for "${args.query}"`;
    case 'open_spotify': return 'Opened Spotify';
    case 'open_whatsapp': return 'Opened WhatsApp';
    case 'prepare_whatsapp_message': return `Prepared a WhatsApp message${args.phone ? ` for ${args.phone}` : ''} (not sent yet)`;
    case 'open_telegram': return 'Opened Telegram';
    case 'prepare_telegram_message': return `Prepared a Telegram message for @${args.username} (not sent yet)`;
    case 'send_prepared_message': return result?.success ? 'Sent the message' : 'Could not verify the message was sent';
    case 'open_whatsapp_chat_window': return 'Opened WhatsApp chat window';
    case 'read_whatsapp_chat': return result?.success ? 'Read the WhatsApp chat' : 'Could not read the WhatsApp chat';
    case 'open_telegram_chat_window': return 'Opened Telegram chat window';
    case 'read_telegram_chat': return result?.success ? 'Read the Telegram chat' : 'Could not read the Telegram chat';
    case 'prepare_email_message': return `Prepared an email to ${args.to} (not sent yet)`;
    case 'read_screen': return 'Looked at the screen';
    case 'find_ui_element': return result?.found === false ? `Couldn't find "${args.target}" on screen` : `Located "${args.target}" on screen`;
    case 'get_screen_context': return result?.enabled ? 'Checked the background screen summary' : 'Screen awareness is off';
    case 'extract_screen_text': return 'Read the text on screen';
    case 'run_macro': return `Ran macro "${args.name}"`;
    case 'run_automation': return `Ran automation "${args.label || 'sequence'}"`;
    case 'resolve_contact': return result?.contact ? `Found contact: ${result.contact.name}` : `Couldn't resolve "${args.query}"`;
    case 'add_contact': return `Saved contact: ${args.name}`;
    case 'update_contact': return `Updated contact: ${args.name}`;
    case 'delete_contact': return `Removed contact: ${args.name}`;
    case 'list_contacts': return 'Listed saved contacts';
    case 'call_contact': return result?.success ? `Dialed ${result.label || result.dialed}` : `Couldn't place the call`;
    case 'open_web_page': return result?.success ? `Opened ${args.url}` : `Couldn't open ${args.url}`;
    case 'read_web_page': return result?.success ? 'Read the page' : "Couldn't read the page";
    case 'find_web_element': return result?.found === false ? `Couldn't confidently find "${args.target}" on the page` : `Located "${args.target}" on the page`;
    case 'click_web_element': return result?.success ? 'Clicked the element' : "Couldn't click that element";
    case 'type_into_web_field': return result?.success ? 'Typed into the field' : "Couldn't type into that field";
    case 'close_web_page': return 'Closed the automation browser window';
    case 'create_scheduled_task': return result?.success ? `Scheduled "${args.label}"` : `Couldn't schedule "${args.label}"`;
    case 'list_scheduled_tasks': return 'Listed scheduled tasks';
    case 'delete_scheduled_task': return result?.deleted ? 'Deleted the scheduled task' : "Couldn't find that scheduled task";
    default: return `${name} completed`;
  }
}

export interface LiveSessionCallbacks {
  onStateChange: (state: SessionState) => void;
  onVolumeChange: (volume: number, source: 'user' | 'anushka') => void;
  onTranscript: (item: TranscriptItem) => void;
  onToolCall: (item: ToolCallItem) => void;
  onMoodChange: (mood: MoodTheme) => void;
  onEffectTrigger: (effect: string) => void;
  onError: (errorMsg: string) => void;
}

export class AnushkaLiveSession {
  private ws: WebSocket | null = null;
  private inputManager: AudioInputManager | null = null;
  private outputManager: AudioOutputManager | null = null;
  private state: SessionState = 'disconnected';
  private selectedVoice: VoiceName = 'Kore';
  private isMuted: boolean = false;
  private callbacks: LiveSessionCallbacks;

  constructor(callbacks: LiveSessionCallbacks) {
    this.callbacks = callbacks;
  }

  public getState(): SessionState {
    return this.state;
  }

  public getVoice(): VoiceName {
    return this.selectedVoice;
  }

  public isMicMuted(): boolean {
    return this.isMuted;
  }

  private setState(newState: SessionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.callbacks.onStateChange(newState);
    }
  }

  public async connect(voice: VoiceName = 'Kore'): Promise<void> {
    // Bug: this used to only check for 'connecting' | 'listening' |
    // 'speaking'. If connect() was called again while state was
    // 'reconnecting' or 'error' (both real, reachable states — see
    // onclose/onerror below), the guard was skipped entirely and a second
    // WebSocket + a second AudioInputManager/AudioOutputManager got created
    // on top of the still-live ones instead of replacing them: two mics
    // capturing at once, duplicate audio, and a leaked socket. Any existing
    // session must always be torn down first, regardless of which state
    // it's in.
    if (this.state !== 'disconnected') {
      await this.disconnect();
    }

    this.selectedVoice = voice;
    this.setState('connecting');

    try {
      // 1. Initialize Audio Output Manager
      this.outputManager = new AudioOutputManager(
        (vol) => this.callbacks.onVolumeChange(vol, 'anushka'),
        (isSpeaking) => {
          if (this.state !== 'connecting' && this.state !== 'disconnected' && this.state !== 'error') {
            this.setState(isSpeaking ? 'speaking' : 'listening');
          }
        }
      );

      // 2. Establish WebSocket to Server Proxy
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/live-ws`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[AnushkaSession] WebSocket opened, sending init config...');
        this.ws?.send(
          JSON.stringify({
            type: 'init',
            voice: this.selectedVoice,
          })
        );
      };

      this.ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'ready') {
            console.log('[AnushkaSession] Gemini Live is READY');
            this.setState('listening');

            // Start Audio Microphone Input capture
            this.inputManager = new AudioInputManager(
              (base64Pcm) => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                  this.ws.send(JSON.stringify({ type: 'audio', audio: base64Pcm }));
                }
              },
              (vol) => this.callbacks.onVolumeChange(vol, 'user')
            );
            await this.inputManager.start();
            if (this.state === 'disconnected') {
              await this.inputManager.stop();
              this.inputManager = null;
            }
          } else if (msg.type === 'audio') {
            if (msg.audio) {
              this.outputManager?.playAudioChunk(msg.audio);
            }
          } else if (msg.type === 'interrupted') {
            console.log('[AnushkaSession] Model Interrupted by user');
            this.outputManager?.stopAll();
            this.setState('listening');
          } else if (msg.type === 'transcription') {
            if (msg.text && msg.text.trim().length > 0) {
              this.callbacks.onTranscript({
                id: Math.random().toString(36).substring(2, 9),
                source: msg.source || 'anushka',
                text: msg.text.trim(),
                timestamp: Date.now(),
              });
            }
          } else if (msg.type === 'tool_call') {
            await this.handleToolCall(msg.id, msg.name, msg.args || {});
          } else if (msg.type === 'reconnecting') {
            // Server-side Gemini session hit its time limit (or a GoAway
            // warning) and is transparently opening a fresh one. The mic
            // stream and this WebSocket stay up the whole time — only the
            // status indicator changes, so this reads as a brief hiccup
            // instead of the app going dead.
            console.log('[AnushkaSession] Server is reconnecting the Gemini session...');
            if (this.state === 'listening' || this.state === 'speaking') {
              this.setState('reconnecting');
            }
          } else if (msg.type === 'reconnected') {
            console.log('[AnushkaSession] Gemini session reconnected');
            if (this.state === 'reconnecting') {
              this.setState('listening');
            }
          } else if (msg.type === 'session_closed') {
            // Only sent now after the server itself gave up retrying — a
            // genuine terminal failure, not the routine expiry this whole
            // reconnect flow exists to hide.
            console.error('[AnushkaSession] Session closed permanently:', msg.error);
            this.callbacks.onError(msg.error || 'The voice session ended and could not be resumed. Tap to reconnect.');
            await this.disconnect();
          } else if (msg.type === 'error') {
            console.error('[AnushkaSession] Server Error:', msg.error);
            this.callbacks.onError(msg.error || 'Connection error occurred');
            this.setState('error');
          }
        } catch (err) {
          console.error('[AnushkaSession] Error parsing message:', err);
        }
      };

      this.ws.onerror = (err) => {
        console.error('[AnushkaSession] WebSocket error:', err);
        this.callbacks.onError('WebSocket connection error. Make sure server is running.');
        this.setState('error');
        // Bug: this previously left the mic (AudioInputManager) and any
        // queued output audio running indefinitely — getUserMedia stream
        // and AudioContext both stayed alive with nothing able to use them,
        // since audio sends are gated on `ws.readyState === OPEN`. Release
        // them here so a dead connection doesn't quietly keep the mic hot.
        void this.releaseLocalAudioResources();
      };

      this.ws.onclose = () => {
        console.log('[AnushkaSession] WebSocket closed');
        if (this.state !== 'error') {
          this.setState('disconnected');
        }
        // Same leak as onerror above, for a close that wasn't triggered by
        // our own disconnect() (which already cleans these up itself).
        void this.releaseLocalAudioResources();
      };
    } catch (err: any) {
      console.error('[AnushkaSession] Connection failed:', err);
      this.callbacks.onError(err.message || 'Failed to start voice session');
      this.setState('error');
    }
  }

  // Executes Tool Calls requested by Anushka and returns instant tool_response
  private async handleToolCall(id: string, name: string, args: Record<string, any>): Promise<void> {
    console.log('[AnushkaSession] Executing Tool Call:', name, args);

    let resultSummary = 'Action completed';
    let responseObj: any = { status: 'success' };

    try {
      if (name === 'openWebsite') {
        let url = args.url || '';
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url;
        }
        window.open(url, '_blank');
        resultSummary = `Opened ${args.title || url} in a new tab`;
        responseObj = { result: `Website ${url} opened successfully in browser.` };
      } else if (name === 'setMoodTheme') {
        const mood = args.mood as MoodTheme;
        if (mood) {
          this.callbacks.onMoodChange(mood);
          resultSummary = `Changed visual aura to ${mood}`;
          responseObj = { result: `App visual theme updated to ${mood}` };
        }
      } else if (name === 'getSystemInfo') {
        const now = new Date();
        const info = {
          time: now.toLocaleTimeString(),
          date: now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
        resultSummary = `Provided current local time (${info.time})`;
        responseObj = info;
      } else if (name === 'getDeviceBatteryStatus') {
        let batteryData = {
          levelPercent: 'Unknown',
          charging: false,
          statusDescription: 'Battery API unavailable on this browser',
        };
        try {
          if ('getBattery' in navigator) {
            const batt = await (navigator as any).getBattery();
            const pct = Math.round(batt.level * 100);
            const chargingStr = batt.charging ? 'Plugged in & Charging' : 'Discharging on Battery Power';
            batteryData = {
              levelPercent: `${pct}%`,
              charging: batt.charging,
              statusDescription: `Device Battery is at ${pct}%, ${chargingStr}.`,
            };
            resultSummary = `Battery: ${pct}% (${batt.charging ? 'Charging' : 'Discharging'})`;
          } else {
            resultSummary = `Battery API restricted on browser`;
          }
        } catch (err: any) {
          console.warn('Battery fetch error:', err);
        }
        responseObj = batteryData;
      } else if (name === 'getDeviceLocation') {
        let locationData: any = {
          status: 'Location permission pending or unavailable',
        };
        try {
          if ('geolocation' in navigator) {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 30000,
              });
            });

            const lat = pos.coords.latitude.toFixed(5);
            const lng = pos.coords.longitude.toFixed(5);
            const accuracy = Math.round(pos.coords.accuracy);

            locationData = {
              latitude: lat,
              longitude: lng,
              accuracyMeters: `${accuracy} meters`,
              locationStatus: `Exact Device Geolocation: Latitude ${lat}, Longitude ${lng} (Accuracy: ±${accuracy}m)`,
            };
            resultSummary = `GPS: Lat ${lat}, Lng ${lng} (±${accuracy}m)`;
          } else {
            locationData = { error: 'Geolocation is not supported by this browser.' };
            resultSummary = 'Geolocation not supported';
          }
        } catch (err: any) {
          console.warn('Geolocation fetch error:', err);
          locationData = {
            error: `Geolocation error: ${err.message || 'Permission denied or timed out'}`,
          };
          resultSummary = 'Location permission denied or unavailable';
        }
        responseObj = locationData;
      } else if (name === 'showConfettiOrEffect') {
        const effect = args.effect || 'hearts';
        this.callbacks.onEffectTrigger(effect);
        resultSummary = `Triggered ${effect} particle animation`;
        responseObj = { result: `Effect ${effect} displayed on screen` };
      } else if (OS_TOOL_NAMES.has(name)) {
        // Desktop control tools — only available inside the Electron app
        // (electron/tools/registry.ts). In a plain browser tab there's no
        // OS bridge, so we tell the model that plainly instead of failing
        // silently or pretending to have done something.
        if (window.anushka?.isElectron) {
          const result = await window.anushka.invokeTool(name, args);
          if (result?.success === false) {
            resultSummary = `Failed: ${result.error || 'unknown error'}`;
            responseObj = { error: result.error || 'Tool execution failed' };
          } else {
            resultSummary = summarizeOsTool(name, args, result);
            responseObj = { result };
          }
        } else {
          resultSummary = 'Desktop control unavailable in browser mode';
          responseObj = {
            error: 'This action requires the Anushka AI desktop app for Windows — it is not available in the browser.',
          };
        }
      }
    } catch (err: any) {
      console.error('[AnushkaSession] Tool execution error:', err);
      resultSummary = `Failed: ${err.message}`;
      responseObj = { error: err.message || 'Tool execution failed' };
    }

    // Log Tool Call for UI Toast & Feed
    this.callbacks.onToolCall({
      id,
      name,
      args,
      timestamp: Date.now(),
      status: 'completed',
      resultSummary,
    });

    // Send toolResponse back to Gemini Live
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'tool_response',
          id,
          name,
          response: responseObj,
        })
      );
    }
  }

  // Sends text prompt input to Gemini Live session
  public sendTextInput(text: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'text_input',
          text,
        })
      );
    }
  }

  // Toggle microphone mute
  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.inputManager) {
      this.inputManager.setMute(this.isMuted);
    }
    return this.isMuted;
  }

  // User manual interruption button ("Stop speaking")
  public interrupt(): void {
    if (this.outputManager) {
      this.outputManager.stopAll();
    }
    this.setState('listening');
  }

  // Change voice setting dynamically
  public async changeVoice(voice: VoiceName): Promise<void> {
    this.selectedVoice = voice;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'change_voice',
          voice,
        })
      );
    }
  }

  // Releases the microphone and speaker resources without touching the
  // WebSocket — used when the socket has already closed/errored on its own
  // (see onclose/onerror) so we don't try to close an already-dead socket,
  // but still must not leave the mic capturing into nowhere.
  private async releaseLocalAudioResources(): Promise<void> {
    if (this.inputManager) {
      await this.inputManager.stop();
      this.inputManager = null;
    }
    if (this.outputManager) {
      this.outputManager.close();
      this.outputManager = null;
    }
  }

  // Clean disconnect
  public async disconnect(): Promise<void> {
    await this.releaseLocalAudioResources();

    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }

    this.setState('disconnected');
  }
}
