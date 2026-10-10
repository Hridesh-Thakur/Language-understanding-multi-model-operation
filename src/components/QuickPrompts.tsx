import React from 'react';
import { Sparkles, Tv, Flame, Heart, Smile, Palette, Compass } from 'lucide-react';
import { MoodTheme } from '../types';

interface QuickPromptsProps {
  onSendPrompt: (promptText: string) => void;
  onSetMood: (mood: MoodTheme) => void;
  disabled: boolean;
}

const QUICK_STARTERS = [
  {
    icon: '😉',
    label: 'Flirty Compliment',
    prompt: 'Give me a flirty, witty, and confident compliment!',
  },
  {
    icon: '💅',
    label: 'Roast My Productivity',
    prompt: 'Roast my productivity today in your bold, sassy girlfriend style!',
  },
  {
    icon: '🎬',
    label: 'Open YouTube',
    prompt: 'Hey Lumo, open YouTube for me so I can play some music.',
  },
  {
    icon: '🔮',
    label: 'Cyberpunk Aura',
    prompt: 'Change your visual aura theme to Cyberpunk Violet!',
  },
  {
    icon: '💬',
    label: 'Witty One-Liner',
    prompt: 'Tell me your sharpest, most confident witty one-liner right now.',
  },
  {
    icon: '👑',
    label: 'Give Me Advice',
    prompt: 'What should I wear or do today to feel like a total boss?',
  },
];

export const QuickPrompts: React.FC<QuickPromptsProps> = ({
  onSendPrompt,
  onSetMood,
  disabled,
}) => {
  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-2 z-20">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1">
          <Sparkles className="w-3.5 h-3.5 text-pink-400" />
          <span>Quick Flirt & Action Prompts</span>
        </span>
        <span className="text-[11px] text-slate-500 font-medium">Tap to whisper to Lumo</span>
      </div>

      <div className="flex items-center space-x-2 overflow-x-auto pb-2 scrollbar-none snap-x">
        {QUICK_STARTERS.map((starter, idx) => (
          <button
            key={idx}
            onClick={() => onSendPrompt(starter.prompt)}
            disabled={disabled}
            className={`snap-start flex-none flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-medium bg-slate-900/90 border border-white/10 text-slate-200 hover:border-pink-500/50 hover:bg-slate-800 hover:text-white transition-all cursor-pointer backdrop-blur-md shadow-lg active:scale-95 ${
              disabled ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <span className="text-sm">{starter.icon}</span>
            <span className="whitespace-nowrap">{starter.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
