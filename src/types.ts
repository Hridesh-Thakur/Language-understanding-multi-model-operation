export type SessionState = 'disconnected' | 'connecting' | 'reconnecting' | 'listening' | 'speaking' | 'error';

export type VoiceName = 'Kore' | 'Aoede' | 'Zephyr' | 'Puck' | 'Fenrir';

export type MoodTheme = 'flirty_pink' | 'cyberpunk_purple' | 'neon_emerald' | 'midnight_blue' | 'sunset_gold';

export interface ToolCallItem {
  id: string;
  name: string;
  args: Record<string, any>;
  timestamp: number;
  status: 'executing' | 'completed' | 'failed';
  resultSummary?: string;
}

export interface TranscriptItem {
  id: string;
  source: 'user' | 'anushka';
  text: string;
  timestamp: number;
}

export interface MoodConfig {
  id: MoodTheme;
  name: string;
  primaryColor: string;
  secondaryColor: string;
  accentGlow: string;
  bgGradient: string;
  icon: string;
}

export const MOOD_THEMES: Record<MoodTheme, MoodConfig> = {
  flirty_pink: {
    id: 'flirty_pink',
    name: 'Flirty Magenta',
    primaryColor: '#ec4899',
    secondaryColor: '#f43f5e',
    accentGlow: 'rgba(236, 72, 153, 0.5)',
    bgGradient: 'from-pink-950 via-rose-950 to-slate-950',
    icon: '💖',
  },
  cyberpunk_purple: {
    id: 'cyberpunk_purple',
    name: 'Cyberpunk Violet',
    primaryColor: '#a855f7',
    secondaryColor: '#3b82f6',
    accentGlow: 'rgba(168, 85, 247, 0.5)',
    bgGradient: 'from-purple-950 via-indigo-950 to-slate-950',
    icon: '🔮',
  },
  neon_emerald: {
    id: 'neon_emerald',
    name: 'Neon Emerald',
    primaryColor: '#10b981',
    secondaryColor: '#06b6d4',
    accentGlow: 'rgba(16, 185, 129, 0.5)',
    bgGradient: 'from-emerald-950 via-teal-950 to-slate-950',
    icon: '✨',
  },
  midnight_blue: {
    id: 'midnight_blue',
    name: 'Midnight Electric',
    primaryColor: '#0ea5e9',
    secondaryColor: '#6366f1',
    accentGlow: 'rgba(14, 165, 233, 0.5)',
    bgGradient: 'from-sky-950 via-slate-900 to-zinc-950',
    icon: '⚡',
  },
  sunset_gold: {
    id: 'sunset_gold',
    name: 'Sunset Amber',
    primaryColor: '#f59e0b',
    secondaryColor: '#f97316',
    accentGlow: 'rgba(245, 158, 11, 0.5)',
    bgGradient: 'from-amber-950 via-orange-950 to-slate-950',
    icon: '👑',
  },
};
