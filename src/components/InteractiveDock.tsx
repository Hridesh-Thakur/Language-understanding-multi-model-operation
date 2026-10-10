import React from 'react';
import {
  Mic,
  MicOff,
  Power,
  Square,
  Sparkles,
  MessageSquare,
  Palette,
  Settings,
  Heart,
  Flame,
  Zap,
  Volume2,
} from 'lucide-react';
import { SessionState, MoodTheme, MOOD_THEMES } from '../types';

interface InteractiveDockProps {
  state: SessionState;
  isMuted: boolean;
  mood: MoodTheme;
  showCaptions: boolean;
  onToggleMute: () => void;
  onInterrupt: () => void;
  onDisconnect: () => void;
  onConnect: () => void;
  onToggleCaptions: () => void;
  onOpenSettings: () => void;
  onTriggerEffect: (effect: string) => void;
  onCycleMood: () => void;
}

export const InteractiveDock: React.FC<InteractiveDockProps> = ({
  state,
  isMuted,
  mood,
  showCaptions,
  onToggleMute,
  onInterrupt,
  onDisconnect,
  onConnect,
  onToggleCaptions,
  onOpenSettings,
  onTriggerEffect,
  onCycleMood,
}) => {
  const currentMood = MOOD_THEMES[mood] || MOOD_THEMES.flirty_pink;
  const isConnected = state === 'listening' || state === 'speaking';

  return (
    <div className="fixed bottom-6 inset-x-4 max-w-2xl mx-auto z-40 pointer-events-auto">
      <div className="bg-slate-950/85 border border-white/15 p-2 rounded-3xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] backdrop-blur-2xl flex items-center justify-between space-x-2">
        {/* Main Mic / Connect Action */}
        {!isConnected ? (
          <button
            onClick={onConnect}
            className="flex-1 flex items-center justify-center space-x-2 py-3 px-5 rounded-2xl bg-gradient-to-r from-pink-500 via-rose-500 to-purple-600 text-white font-bold text-xs sm:text-sm shadow-lg shadow-pink-500/30 hover:opacity-95 active:scale-98 transition-all cursor-pointer"
          >
            <Power className="w-4 h-4" />
            <span>Wake Lumo Live</span>
          </button>
        ) : (
          <div className="flex items-center space-x-1.5">
            {/* Mic Mute Button */}
            <button
              onClick={onToggleMute}
              className={`p-3 rounded-2xl border text-xs font-bold transition-all cursor-pointer ${
                isMuted
                  ? 'bg-rose-500/25 text-rose-300 border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.3)]'
                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
              }`}
              title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
            >
              {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            {/* Interrupt Button when speaking */}
            {state === 'speaking' && (
              <button
                onClick={onInterrupt}
                className="p-3 rounded-2xl bg-pink-500/30 border border-pink-500/50 text-pink-200 hover:bg-pink-500/40 transition-all cursor-pointer shadow-lg"
                title="Interrupt Speech"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            )}

            {/* Disconnect Call */}
            <button
              onClick={onDisconnect}
              className="p-3 rounded-2xl bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30 transition-all cursor-pointer"
              title="End Live Session"
            >
              <Power className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Quick Particle FX Triggers */}
        <div className="flex items-center space-x-1 px-2 border-x border-white/10">
          <button
            onClick={() => onTriggerEffect('hearts')}
            className="p-2.5 rounded-xl bg-slate-900/90 border border-white/10 text-pink-400 hover:bg-pink-500/20 hover:border-pink-500/40 transition-all cursor-pointer active:scale-90"
            title="Trigger Hearts Effect"
          >
            <Heart className="w-4 h-4 fill-pink-500/40" />
          </button>
          <button
            onClick={() => onTriggerEffect('sparkles')}
            className="p-2.5 rounded-xl bg-slate-900/90 border border-white/10 text-amber-300 hover:bg-amber-500/20 hover:border-amber-500/40 transition-all cursor-pointer active:scale-90"
            title="Trigger Sparkles Effect"
          >
            <Sparkles className="w-4 h-4" />
          </button>
          <button
            onClick={() => onTriggerEffect('lightning')}
            className="p-2.5 rounded-xl bg-slate-900/90 border border-white/10 text-cyan-400 hover:bg-cyan-500/20 hover:border-cyan-500/40 transition-all cursor-pointer active:scale-90"
            title="Trigger Lightning Effect"
          >
            <Zap className="w-4 h-4" />
          </button>
        </div>

        {/* Utility Toggles */}
        <div className="flex items-center space-x-1.5">
          {/* Cycle Mood Theme */}
          <button
            onClick={onCycleMood}
            className="flex items-center space-x-1.5 px-3 py-2.5 rounded-2xl bg-slate-900/90 border border-white/10 text-slate-200 hover:bg-slate-800 text-xs font-semibold transition-all cursor-pointer"
            title="Switch Visual Aura Theme"
          >
            <span>{currentMood.icon}</span>
            <span className="hidden sm:inline text-[11px]">{currentMood.name}</span>
          </button>

          {/* Captions Toggle */}
          <button
            onClick={onToggleCaptions}
            className={`p-2.5 rounded-2xl border transition-all cursor-pointer ${
              showCaptions
                ? 'bg-pink-500/20 text-pink-300 border-pink-500/40 shadow-[0_0_12px_rgba(236,72,153,0.3)]'
                : 'bg-slate-900/90 text-slate-400 border-white/10 hover:text-white'
            }`}
            title="Toggle Live Captions"
          >
            <MessageSquare className="w-4 h-4" />
          </button>

          {/* Settings Modal */}
          <button
            onClick={onOpenSettings}
            className="p-2.5 rounded-2xl bg-slate-900/90 border border-white/10 text-slate-300 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
            title="Assistant Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
