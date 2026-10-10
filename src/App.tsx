import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnushkaLiveSession } from './lib/liveSession';
import { AuraVisualizer } from './components/AuraVisualizer';
import { CentralControlButton } from './components/CentralControlButton';
import { HeaderNav } from './components/HeaderNav';
import { IntroSplashScreen } from './components/IntroSplashScreen';
import { DeviceTelemetryWidget } from './components/DeviceTelemetryWidget';
import { ToolCallToast } from './components/ToolCallToast';
import { ScreenAwarenessNotice } from './components/ScreenAwarenessNotice';
import { CaptionOverlay } from './components/CaptionOverlay';
import { ParticleEffects } from './components/ParticleEffects';
import { SettingsModal } from './components/SettingsModal';
import { ConfirmationOverlay } from './components/ConfirmationOverlay';
import {
  SessionState,
  VoiceName,
  MoodTheme,
  MOOD_THEMES,
  TranscriptItem,
  ToolCallItem,
} from './types';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

const MOOD_LIST: MoodTheme[] = [
  'flirty_pink',
  'cyberpunk_purple',
  'neon_emerald',
  'midnight_blue',
  'sunset_gold',
];

export default function App() {
  const [state, setState] = useState<SessionState>('disconnected');
  const [userVolume, setUserVolume] = useState<number>(0);
  const [anushkaVolume, setAnushkaVolume] = useState<number>(0);
  const [voice, setVoice] = useState<VoiceName>('Kore');
  const [mood, setMood] = useState<MoodTheme>('flirty_pink');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [latestToolCall, setLatestToolCall] = useState<ToolCallItem | null>(null);
  const [activeEffect, setActiveEffect] = useState<string | null>(null);
  const [showCaptions, setShowCaptions] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showIntro, setShowIntro] = useState<boolean>(true);

  const [pendingConfirm, setPendingConfirm] = useState<{ id: string; tool: string; risk: 'low' | 'medium' | 'high' } | null>(null);
  const [screenNotice, setScreenNotice] = useState<{ summary: string; reason?: string; at: number } | null>(null);

  const sessionRef = useRef<AnushkaLiveSession | null>(null);

  // Listen for high/medium-risk desktop actions that need explicit approval
  // (electron/tools/registry.ts asks for this before running them).
  useEffect(() => {
    if (!window.anushka) return; // browser mode: no desktop bridge, nothing to confirm
    const unsubscribe = window.anushka.onConfirmRequest(({ id, tool, risk }) => {
      setPendingConfirm({ id, tool, risk });
    });
    return unsubscribe;
  }, []);

  // Pass 6 — passive banner only when the background screen-awareness loop
  // (electron/main/screenAwareness.ts) flags something notable. Does NOT
  // touch transcripts/session state — Anushka never speaks about this
  // unprompted, the user just sees it and can ask if they want to know more.
  useEffect(() => {
    if (!window.anushka) return;
    const unsubscribe = window.anushka.onScreenNotableChange((payload) => {
      setScreenNotice(payload);
    });
    return unsubscribe;
  }, []);

  const respondToConfirm = useCallback((approved: boolean) => {
    if (pendingConfirm) {
      window.anushka?.sendConfirmResponse(pendingConfirm.id, approved);
      setPendingConfirm(null);
    }
  }, [pendingConfirm]);

  // Global voice emergency stop / resume — "Anushka stop" halts any
  // in-flight automation immediately, regardless of what else is happening.
  useEffect(() => {
    const last = transcripts[transcripts.length - 1];
    if (!last || last.source !== 'user') return;
    const text = last.text.toLowerCase();
    if (/\blumo,?\s+stop\b/.test(text)) {
      window.anushka?.emergencyStop();
    } else if (/\blumo,?\s+resume\b/.test(text)) {
      window.anushka?.resume();
    } else if (pendingConfirm && /\b(yes|confirm|do it|approve)\b/.test(text)) {
      respondToConfirm(true);
    } else if (pendingConfirm && /\b(no|cancel|deny|stop)\b/.test(text)) {
      respondToConfirm(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcripts]);

  // Initialize Anushka Live Session instance
  useEffect(() => {
    sessionRef.current = new AnushkaLiveSession({
      onStateChange: (newState) => {
        setState(newState);
        if (newState === 'listening' || newState === 'speaking') {
          setErrorMessage(null);
        }
      },
      onVolumeChange: (vol, source) => {
        if (source === 'user') setUserVolume(vol);
        else setAnushkaVolume(vol);
      },
      onTranscript: (item) => {
        setTranscripts((prev) => [...prev, item]);
      },
      onToolCall: (toolCall) => {
        setLatestToolCall(toolCall);
      },
      onMoodChange: (newMood) => {
        setMood(newMood);
      },
      onEffectTrigger: (effect) => {
        setActiveEffect(effect);
      },
      onError: (msg) => {
        setErrorMessage(msg);
      },
    });

    return () => {
      sessionRef.current?.disconnect();
    };
  }, []);

  // Connect to Anushka Live Voice API
  const handleConnect = useCallback(async () => {
    setErrorMessage(null);
    if (sessionRef.current) {
      await sessionRef.current.connect(voice);
    }
  }, [voice]);

  // Disconnect session
  const handleDisconnect = useCallback(async () => {
    if (sessionRef.current) {
      await sessionRef.current.disconnect();
    }
  }, []);

  // Toggle Mute
  const handleToggleMute = useCallback(() => {
    if (sessionRef.current) {
      const muted = sessionRef.current.toggleMute();
      setIsMuted(muted);
    }
  }, []);

  // Interrupt Anushka speech
  const handleInterrupt = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.interrupt();
    }
  }, []);

  // Change voice profile
  const handleSelectVoice = useCallback(
    async (newVoice: VoiceName) => {
      setVoice(newVoice);
      if (sessionRef.current && (state === 'listening' || state === 'speaking')) {
        await sessionRef.current.changeVoice(newVoice);
      }
    },
    [state]
  );

  // Cycle to next mood theme
  const handleCycleMood = useCallback(() => {
    setMood((prev) => {
      const idx = MOOD_LIST.indexOf(prev);
      const nextIdx = (idx + 1) % MOOD_LIST.length;
      return MOOD_LIST[nextIdx];
    });
  }, []);

  const currentMoodConfig = MOOD_THEMES[mood] || MOOD_THEMES.flirty_pink;

  return (
    <div
      className={`relative min-h-screen w-full flex flex-col justify-between overflow-hidden bg-gradient-to-b ${currentMoodConfig.bgGradient} bg-cyber-grid text-white select-none transition-colors duration-1000`}
    >
      {/* Dynamic Ambient Background Glows */}
      <div
        className="absolute inset-0 pointer-events-none opacity-40 transition-all duration-1000 animate-pulse-glow"
        style={{
          background: `radial-gradient(circle at 50% 45%, ${currentMoodConfig.primaryColor} 0%, transparent 65%)`,
        }}
      />
      <div
        className="absolute top-1/4 -left-20 w-96 h-96 rounded-full pointer-events-none opacity-20 blur-3xl"
        style={{ backgroundColor: currentMoodConfig.primaryColor }}
      />
      <div
        className="absolute bottom-1/4 -right-20 w-96 h-96 rounded-full pointer-events-none opacity-20 blur-3xl"
        style={{ backgroundColor: currentMoodConfig.secondaryColor }}
      />

      {/* Device Telemetry Widget for Live Battery & GPS Status */}
      <DeviceTelemetryWidget />

      {/* Header Navigation */}
      <HeaderNav
        state={state}
        voice={voice}
        mood={mood}
        showCaptions={showCaptions}
        onToggleCaptions={() => setShowCaptions((prev) => !prev)}
        onOpenSettings={() => setShowSettings(true)}
        onSelectMood={setMood}
      />

      {/* Main Center Audio Visualizer Stage */}
      <main className="relative flex-1 flex flex-col items-center justify-center px-4 z-10 my-4">
        {/* Canvas Visualizer Sphere with Spectrum & HUD Rings */}
        <div className="absolute inset-0 w-full h-full flex items-center justify-center">
          <AuraVisualizer
            state={state}
            userVolume={userVolume}
            anushkaVolume={anushkaVolume}
            mood={mood}
          />
        </div>

        {/* Center Power / Session Control Button */}
        <CentralControlButton
          state={state}
          isMuted={isMuted}
          mood={mood}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onToggleMute={handleToggleMute}
          onInterrupt={handleInterrupt}
        />

        {/* Error Banner */}
        {errorMessage && (
          <div className="mt-6 z-20 max-w-md w-full bg-rose-950/90 border border-rose-500/50 p-4 rounded-2xl shadow-2xl backdrop-blur-md flex items-center space-x-3 text-rose-200 text-xs animate-bounce-in">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div className="flex-1">
              <p className="font-bold">Session Notice</p>
              <p className="opacity-90">{errorMessage}</p>
            </div>
            <button
              onClick={handleConnect}
              className="p-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-white font-semibold transition-all cursor-pointer flex items-center space-x-1 shrink-0"
            >
              <RefreshCcw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}
      </main>

      {/* Overlays & Drawers */}
      <CaptionOverlay
        transcripts={transcripts}
        isOpen={showCaptions}
        onClose={() => setShowCaptions(false)}
      />

      <ToolCallToast toolCall={latestToolCall} />

      <ScreenAwarenessNotice notice={screenNotice} onDismiss={() => setScreenNotice(null)} />

      <ParticleEffects
        effectName={activeEffect}
        onFinished={() => setActiveEffect(null)}
      />

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        currentVoice={voice}
        onSelectVoice={handleSelectVoice}
        currentMood={mood}
        onSelectMood={setMood}
      />

      {pendingConfirm && (
        <ConfirmationOverlay
          tool={pendingConfirm.tool}
          risk={pendingConfirm.risk}
          onApprove={() => respondToConfirm(true)}
          onDeny={() => respondToConfirm(false)}
        />
      )}

      {/* Futuristic Opening Splash Screen Animation */}
      {showIntro && (
        <IntroSplashScreen onComplete={() => setShowIntro(false)} />
      )}
    </div>
  );
}

