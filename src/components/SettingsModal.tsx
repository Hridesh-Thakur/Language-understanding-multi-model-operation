import React, { useState, useEffect } from 'react';
import { X, Radio, Sparkles, Volume2, ShieldCheck, Check, Info, Battery, MapPin, Zap, RefreshCcw, Eye } from 'lucide-react';
import { VoiceName, MoodTheme, MOOD_THEMES } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentVoice: VoiceName;
  onSelectVoice: (voice: VoiceName) => void;
  currentMood: MoodTheme;
  onSelectMood: (mood: MoodTheme) => void;
}

const VOICES: { id: VoiceName; name: string; trait: string; description: string }[] = [
  {
    id: 'Kore',
    name: 'Kore (Realistic Young Female)',
    trait: 'Sweet & Charming',
    description: 'Ultra-realistic young female voice with warm human inflections, natural cadence, and sweet girlfriend vibe.',
  },
  {
    id: 'Aoede',
    name: 'Aoede (Playful Real Girl)',
    trait: 'Witty & Expressive',
    description: 'Vibrant, bright female voice with expressive speech rhythm, playful banter, and natural laughter.',
  },
  {
    id: 'Zephyr',
    name: 'Zephyr (Soft & Smooth)',
    trait: 'Casual & Intimate',
    description: 'Silky, relaxed young voice with soft conversational warmth and cozy close-friend vibe.',
  },
  {
    id: 'Puck',
    name: 'Puck',
    trait: 'Teasing & Edgy',
    description: 'High-energy expressive tone loaded with playful teasing and cheerful banter.',
  },
  {
    id: 'Fenrir',
    name: 'Fenrir',
    trait: 'Bold & Direct',
    description: 'Deeper, confident voice profile for a strong, expressive presence.',
  },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  currentVoice,
  onSelectVoice,
  currentMood,
  onSelectMood,
}) => {
  const [batteryLevel, setBatteryLevel] = useState<string>('Checking...');
  const [batteryCharging, setBatteryCharging] = useState<boolean | null>(null);
  const [gpsLocation, setGpsLocation] = useState<string>('Requesting GPS...');
  const [trustedMode, setTrustedMode] = useState<boolean>(true);
  const [screenAwarenessEnabled, setScreenAwarenessEnabled] = useState<boolean>(false);
  const [screenAwarenessIntervalSec, setScreenAwarenessIntervalSec] = useState<number>(25);

  useEffect(() => {
    if (!isOpen || !window.anushka) return;
    window.anushka.getSettings().then((s) => {
      setTrustedMode(s.trustedMode);
      setScreenAwarenessEnabled(Boolean(s.screenAwarenessEnabled));
      setScreenAwarenessIntervalSec(s.screenAwarenessIntervalSec || 25);
    }).catch(() => {});
  }, [isOpen]);

  const toggleTrustedMode = () => {
    const next = !trustedMode;
    setTrustedMode(next);
    window.anushka?.updateSettings({ trustedMode: next }).catch(() => {});
  };

  const toggleScreenAwareness = () => {
    const next = !screenAwarenessEnabled;
    setScreenAwarenessEnabled(next);
    window.anushka?.updateSettings({ screenAwarenessEnabled: next }).catch(() => {});
  };

  const changeScreenAwarenessInterval = (sec: number) => {
    setScreenAwarenessIntervalSec(sec);
    window.anushka?.updateSettings({ screenAwarenessIntervalSec: sec }).catch(() => {});
  };

  useEffect(() => {
    if (!isOpen) return;

    // Check battery
    if ('getBattery' in navigator) {
      (navigator as any).getBattery().then((batt: any) => {
        setBatteryLevel(`${Math.round(batt.level * 100)}%`);
        setBatteryCharging(batt.charging);
      }).catch(() => {
        setBatteryLevel('Unavailable');
      });
    } else {
      setBatteryLevel('N/A (Browser Restricted)');
    }

    // Check location
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGpsLocation(
            `Lat ${pos.coords.latitude.toFixed(4)}°, Lng ${pos.coords.longitude.toFixed(4)}° (±${Math.round(pos.coords.accuracy)}m)`
          );
        },
        (err) => {
          setGpsLocation(`Denied or Unavailable (${err.message})`);
        },
        { timeout: 8000 }
      );
    } else {
      setGpsLocation('Geolocation unsupported');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="bg-slate-900 border border-white/15 rounded-3xl max-w-lg w-full p-6 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-5 h-5 text-pink-400" />
            <h2 className="text-base font-bold text-white">Lumo Persona & Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto space-y-6 pt-4 pr-1 scrollbar-thin">
          {/* Voice Personality Selector */}
          <div>
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block mb-3 flex items-center space-x-1.5">
              <Radio className="w-4 h-4 text-pink-400" />
              <span>Select Assistant Voice Profile</span>
            </label>
            <div className="space-y-2">
              {VOICES.map((v) => (
                <button
                  key={v.id}
                  onClick={() => onSelectVoice(v.id)}
                  className={`w-full flex items-start justify-between p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                    currentVoice === v.id
                      ? 'bg-gradient-to-r from-pink-500/20 to-purple-500/20 border-pink-500/60 shadow-[0_0_15px_rgba(236,72,153,0.2)]'
                      : 'bg-slate-800/60 border-white/10 hover:border-white/30 hover:bg-slate-800'
                  }`}
                >
                  <div className="flex-1 pr-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-bold text-white">{v.name}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-300 border border-pink-500/30">
                        {v.trait}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{v.description}</p>
                  </div>
                  {currentVoice === v.id && (
                    <div className="w-5 h-5 rounded-full bg-pink-500 text-white flex items-center justify-center shrink-0 mt-0.5">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Visual Aura Themes */}
          <div>
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block mb-3">
              App Visual Aura Theme
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(MOOD_THEMES) as MoodTheme[]).map((mKey) => {
                const theme = MOOD_THEMES[mKey];
                const isSelected = currentMood === mKey;
                return (
                  <button
                    key={mKey}
                    onClick={() => onSelectMood(mKey)}
                    className={`flex items-center space-x-2.5 p-3 rounded-2xl border text-xs font-medium transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-slate-800 border-pink-500 text-white shadow-lg'
                        : 'bg-slate-900/60 border-white/10 text-slate-300 hover:border-white/20'
                    }`}
                  >
                    <span className="text-base">{theme.icon}</span>
                    <span className="truncate">{theme.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Trusted Mode / Automation permissions */}
          {window.anushka && (
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-white/10 space-y-3">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block flex items-center space-x-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Automation Permissions</span>
              </label>
              <button
                onClick={toggleTrustedMode}
                className={`w-full flex items-center justify-between p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                  trustedMode
                    ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border-emerald-500/60'
                    : 'bg-slate-800/60 border-white/10 hover:border-white/30'
                }`}
              >
                <div className="pr-2">
                  <div className="text-sm font-bold text-white">Trusted Mode</div>
                  <p className="text-xs text-slate-400 mt-1">
                    {trustedMode
                      ? 'On — normal commands (open apps, browse, type, click, volume, files) run immediately, no Yes/No prompts.'
                      : 'Off — every non-trivial action asks for confirmation first.'}
                  </p>
                </div>
                <div
                  className={`shrink-0 w-11 h-6 rounded-full relative transition-colors ${trustedMode ? 'bg-emerald-500' : 'bg-slate-700'}`}
                >
                  <div
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${trustedMode ? 'translate-x-5' : 'translate-x-0.5'}`}
                  />
                </div>
              </button>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Destructive actions (deleting files, shutting down, killing processes, actually sending a message) always ask first — Trusted Mode never skips those.
              </p>
            </div>
          )}

          {/* Screen Awareness — Pass 6, off by default, explicit opt-in */}
          {window.anushka && (
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-white/10 space-y-3">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block flex items-center space-x-1.5">
                <Eye className="w-4 h-4 text-sky-400" />
                <span>Screen Awareness</span>
              </label>
              <button
                onClick={toggleScreenAwareness}
                className={`w-full flex items-center justify-between p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                  screenAwarenessEnabled
                    ? 'bg-gradient-to-r from-sky-500/20 to-cyan-500/20 border-sky-500/60'
                    : 'bg-slate-800/60 border-white/10 hover:border-white/30'
                }`}
              >
                <div className="pr-2">
                  <div className="text-sm font-bold text-white">
                    {screenAwarenessEnabled ? 'On — periodic background check' : 'Off'}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {screenAwarenessEnabled
                      ? `Roughly every ${screenAwarenessIntervalSec}s, checks if the screen changed and only sends it for analysis when it did — not a live video feed.`
                      : "Lumo only looks at your screen when you ask (read_screen / find_ui_element). Turn this on for a light background check that can flag things like a new error or permission prompt."}
                  </p>
                </div>
                <div
                  className={`shrink-0 w-11 h-6 rounded-full relative transition-colors ${screenAwarenessEnabled ? 'bg-sky-500' : 'bg-slate-700'}`}
                >
                  <div
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${screenAwarenessEnabled ? 'translate-x-5' : 'translate-x-0.5'}`}
                  />
                </div>
              </button>

              {screenAwarenessEnabled && (
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] text-slate-400">Check every</span>
                  <div className="flex items-center space-x-1.5">
                    {[10, 25, 60].map((sec) => (
                      <button
                        key={sec}
                        onClick={() => changeScreenAwarenessInterval(sec)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                          screenAwarenessIntervalSec === sec
                            ? 'bg-sky-500 text-white'
                            : 'bg-slate-800 text-slate-400 hover:text-white border border-white/10'
                        }`}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[11px] text-slate-500 leading-relaxed">
                When on, screenshots of whatever is currently on your screen are periodically sent to the Gemini API for analysis, even if you haven't asked Lumo anything. Off by default — this is the one setting in the app that works that way.
              </p>
            </div>
          )}

          {/* Device Telemetry Section */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-white/10 space-y-3">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block flex items-center space-x-1.5">
              <Battery className="w-4 h-4 text-emerald-400" />
              <span>Exact Device Telemetry</span>
            </label>
            <div className="grid grid-cols-1 gap-2 text-xs font-mono">
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-white/5">
                <div className="flex items-center space-x-2 text-slate-300">
                  <Battery className="w-4 h-4 text-emerald-400" />
                  <span>Battery Level:</span>
                </div>
                <div className="flex items-center space-x-1 font-bold text-emerald-300">
                  <span>{batteryLevel}</span>
                  {batteryCharging && <Zap className="w-3.5 h-3.5 text-amber-400 fill-current" />}
                </div>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-white/5">
                <div className="flex items-center space-x-2 text-slate-300">
                  <MapPin className="w-4 h-4 text-pink-400" />
                  <span>Exact GPS Coordinates:</span>
                </div>
                <span className="font-bold text-pink-300 text-[11px] truncate max-w-[180px]">
                  {gpsLocation}
                </span>
              </div>
            </div>
          </div>

          {/* Creators & Bosses Info */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-pink-500/30 space-y-2 text-xs">
            <div className="flex items-center space-x-2 text-pink-400 font-bold uppercase tracking-wider">
              <Sparkles className="w-4 h-4 text-pink-400" />
              <span>Creators & Bosses</span>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-xs">
              <div className="p-2.5 rounded-xl bg-slate-900 border border-white/10 flex items-center space-x-2">
                <span className="text-base">👑</span>
                <div>
                  <div className="text-[10px] text-slate-400">Boss 1 / Creator 1</div>
                  <div className="font-bold text-pink-300">Hridesh Thakur</div>
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-900 border border-white/10 flex items-center space-x-2">
                <span className="text-base">⚡</span>
                <div>
                  <div className="text-[10px] text-slate-400">Boss 2 / Creator 2</div>
                  <div className="font-bold text-purple-300">Hridesh Thakur</div>
                </div>
              </div>
            </div>
          </div>

          {/* Model & Architecture Info */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-white/10 space-y-2 text-xs">
            <div className="flex items-center space-x-2 text-pink-400 font-semibold">
              <ShieldCheck className="w-4 h-4" />
              <span>Gemini 3.1 Live API Engine</span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              Powered by <code className="text-pink-300">gemini-3.1-flash-live-preview</code> with
              direct 16kHz PCM input streaming and 24kHz Web Audio API gapless playback.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-white/10 mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-pink-500 to-rose-500 text-white hover:opacity-90 transition-all cursor-pointer shadow-lg shadow-pink-500/25"
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
};
