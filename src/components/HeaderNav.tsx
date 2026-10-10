import React from 'react';
import { Sparkles, Settings, MessageSquare, Palette, User, Radio } from 'lucide-react';
import { VoiceName, MoodTheme, MOOD_THEMES, SessionState } from '../types';

interface HeaderNavProps {
  state: SessionState;
  voice: VoiceName;
  mood: MoodTheme;
  showCaptions: boolean;
  onToggleCaptions: () => void;
  onOpenSettings: () => void;
  onSelectMood: (mood: MoodTheme) => void;
}

export const HeaderNav: React.FC<HeaderNavProps> = ({
  state,
  voice,
  mood,
  showCaptions,
  onToggleCaptions,
  onOpenSettings,
  onSelectMood,
}) => {
  const currentMood = MOOD_THEMES[mood] || MOOD_THEMES.flirty_pink;

  return (
    <header className="w-full max-w-5xl mx-auto px-6 py-4 flex items-center justify-between z-20">
      {/* Sleek Minimal Status Badge */}
      <div className="flex items-center space-x-2 bg-slate-950/60 border border-white/10 px-3 py-1.5 rounded-full backdrop-blur-md">
        <div className={`w-2 h-2 rounded-full ${state === 'listening' || state === 'speaking' ? 'bg-emerald-400 animate-ping' : 'bg-pink-500'}`} />
        <span className="text-xs font-bold tracking-wider text-slate-200 uppercase">
          {state === 'disconnected' ? 'Lumo AI' : state}
        </span>
      </div>

      {/* Quick Status Bar & Settings Controls */}
      <div className="flex items-center space-x-2 sm:space-x-3">
        {/* Mood Theme Selector Button */}
        <div className="relative group">
          <button
            onClick={() => {
              const keys = Object.keys(MOOD_THEMES) as MoodTheme[];
              const currentIndex = keys.indexOf(mood);
              const nextMood = keys[(currentIndex + 1) % keys.length];
              onSelectMood(nextMood);
            }}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-slate-900/80 border border-white/10 text-xs font-semibold text-slate-200 hover:bg-slate-800 transition-all cursor-pointer backdrop-blur-md"
            title="Change Aura Theme"
          >
            <span>{currentMood.icon}</span>
            <span className="hidden sm:inline">{currentMood.name}</span>
          </button>
        </div>

        {/* Voice Badge */}
        <div className="hidden md:flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-slate-900/80 border border-white/10 text-xs text-pink-300 font-semibold backdrop-blur-md">
          <Radio className="w-3.5 h-3.5 text-pink-400 animate-pulse" />
          <span>Voice: {voice}</span>
        </div>

        {/* Captions Toggle */}
        <button
          onClick={onToggleCaptions}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer backdrop-blur-md border ${
            showCaptions
              ? 'bg-pink-500/20 text-pink-300 border-pink-500/40 shadow-[0_0_10px_rgba(236,72,153,0.3)]'
              : 'bg-slate-900/80 text-slate-400 border-white/10 hover:text-slate-200'
          }`}
          title="Toggle Spoken Captions"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Captions</span>
        </button>

        {/* Settings Button */}
        <button
          onClick={onOpenSettings}
          className="p-2 rounded-full bg-slate-900/80 border border-white/10 text-slate-300 hover:text-white hover:bg-slate-800 transition-all cursor-pointer backdrop-blur-md"
          title="Open Assistant Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
