import React from 'react';
import { Mic, MicOff, Power, Square, Sparkles, Volume2, AlertCircle, RefreshCw } from 'lucide-react';
import { SessionState, MoodTheme, MOOD_THEMES } from '../types';

interface CentralControlButtonProps {
  state: SessionState;
  isMuted: boolean;
  mood: MoodTheme;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMute: () => void;
  onInterrupt: () => void;
}

export const CentralControlButton: React.FC<CentralControlButtonProps> = ({
  state,
  isMuted,
  mood,
  onConnect,
  onDisconnect,
  onToggleMute,
  onInterrupt,
}) => {
  const theme = MOOD_THEMES[mood] || MOOD_THEMES.flirty_pink;

  const renderStatusText = () => {
    switch (state) {
      case 'disconnected':
        return 'Tap to wake Lumo';
      case 'connecting':
        return 'Connecting to Lumo...';
      case 'reconnecting':
        return 'Reconnecting... (your session is being refreshed)';
      case 'listening':
        return isMuted ? 'Mic Muted (Tap to unmute)' : 'Lumo is listening...';
      case 'speaking':
        return 'Lumo is speaking...';
      case 'error':
        return 'Connection Failed (Tap to Retry)';
      default:
        return 'Tap to Wake';
    }
  };

  const getStatusBadgeStyle = () => {
    switch (state) {
      case 'listening':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.3)]';
      case 'speaking':
        return 'bg-pink-500/20 text-pink-300 border-pink-500/40 shadow-[0_0_15px_rgba(236,72,153,0.3)]';
      case 'connecting':
      case 'reconnecting':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.3)]';
      case 'error':
        return 'bg-red-500/20 text-red-300 border-red-500/40';
      default:
        return 'bg-white/10 text-slate-300 border-white/20';
    }
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-6 z-10">
      {/* Main Trigger Button Orb */}
      <div className="relative group">
        {/* Glow halo behind button */}
        <div
          className="absolute -inset-4 rounded-full blur-xl opacity-75 transition-all duration-500 group-hover:opacity-100"
          style={{
            background: `radial-gradient(circle, ${theme.primaryColor} 0%, ${theme.secondaryColor} 100%)`,
          }}
        />

        <button
          onClick={state === 'disconnected' || state === 'error' ? onConnect : onDisconnect}
          className={`relative w-28 h-28 sm:w-36 sm:h-36 rounded-full flex items-center justify-center border-2 transition-all duration-300 active:scale-95 shadow-2xl backdrop-blur-md cursor-pointer ${
            state === 'speaking' || state === 'listening'
              ? 'border-white/80 scale-105'
              : 'border-white/30 hover:border-white/60 hover:scale-105'
          }`}
          style={{
            background: `radial-gradient(circle, rgba(15, 23, 42, 0.85) 0%, rgba(30, 41, 59, 0.95) 100%)`,
            boxShadow: `0 0 35px ${theme.accentGlow}`,
          }}
          aria-label={renderStatusText()}
        >
          {state === 'disconnected' && (
            <Power className="w-12 h-12 sm:w-16 sm:h-16 text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]" />
          )}

          {(state === 'connecting' || state === 'reconnecting') && (
            <RefreshCw className="w-12 h-12 sm:w-16 sm:h-16 text-amber-400 animate-spin" />
          )}

          {state === 'listening' && (
            <div className="flex flex-col items-center justify-center">
              {isMuted ? (
                <MicOff className="w-12 h-12 sm:w-14 sm:h-14 text-rose-400 animate-pulse" />
              ) : (
                <Mic className="w-12 h-12 sm:w-14 sm:h-14 text-emerald-400 animate-bounce" />
              )}
            </div>
          )}

          {state === 'speaking' && (
            <div className="flex items-center space-x-1 sm:space-x-1.5 h-10 sm:h-12">
              <span className="w-1.5 h-8 bg-pink-400 rounded-full animate-[bounce_0.6s_infinite_100ms]" />
              <span className="w-1.5 h-12 bg-rose-400 rounded-full animate-[bounce_0.6s_infinite_200ms]" />
              <span className="w-1.5 h-6 bg-purple-400 rounded-full animate-[bounce_0.6s_infinite_300ms]" />
              <span className="w-1.5 h-10 bg-pink-300 rounded-full animate-[bounce_0.6s_infinite_400ms]" />
            </div>
          )}

          {state === 'error' && (
            <AlertCircle className="w-12 h-12 sm:w-16 sm:h-16 text-rose-500 animate-bounce" />
          )}
        </button>
      </div>

      {/* Status Pill Badge */}
      <div
        className={`px-5 py-2 rounded-full border text-sm font-medium transition-all duration-300 flex items-center space-x-2 backdrop-blur-md ${getStatusBadgeStyle()}`}
      >
        <span className="w-2 h-2 rounded-full bg-current animate-ping" />
        <span>{renderStatusText()}</span>
      </div>

      {/* Session Quick Controls (Mute / Interrupt) */}
      {(state === 'listening' || state === 'speaking') && (
        <div className="flex items-center space-x-4 bg-slate-900/80 p-2 rounded-2xl border border-white/10 backdrop-blur-xl shadow-lg animate-fade-in">
          {/* Mute Mic Button */}
          <button
            onClick={onToggleMute}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              isMuted
                ? 'bg-rose-500/30 text-rose-300 border border-rose-500/50'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }`}
          >
            {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            <span>{isMuted ? 'Unmute Mic' : 'Mute Mic'}</span>
          </button>

          {/* Interrupt Lumo Button */}
          {state === 'speaking' && (
            <button
              onClick={onInterrupt}
              className="flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold bg-pink-500/30 text-pink-200 border border-pink-500/50 hover:bg-pink-500/40 transition-all cursor-pointer"
            >
              <Square className="w-4 h-4 fill-current" />
              <span>Interrupt</span>
            </button>
          )}

          {/* End Call Button */}
          <button
            onClick={onDisconnect}
            className="flex items-center space-x-2 px-3 py-2 rounded-xl text-xs font-semibold bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-all cursor-pointer"
            title="End Session"
          >
            <Power className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
