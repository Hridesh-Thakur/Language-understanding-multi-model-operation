import React, { useState, useEffect } from 'react';
import { Sparkles, Cpu, Radio, ShieldCheck, Zap, Play } from 'lucide-react';

interface IntroSplashScreenProps {
  onComplete: () => void;
}

export const IntroSplashScreen: React.FC<IntroSplashScreenProps> = ({ onComplete }) => {
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('Initializing Neural Core...');
  const [isReady, setIsReady] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Play futuristic Web Audio synthesis powerup sound
    const playPowerupSound = () => {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(180, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 1.2);

        gain.gain.setValueAtTime(0.01, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.4);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 1.5);
      } catch (e) {
        // Audio context play blocked until gesture or unsupported
      }
    };

    playPowerupSound();

    // Progress bar animation timer sequence
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsReady(true);
          return 100;
        }
        const next = prev + Math.floor(Math.random() * 15) + 8;
        if (next > 25 && prev <= 25) setStatusText('Synthesizing Gemini 2.0 Live Audio pipeline...');
        if (next > 60 && prev <= 60) setStatusText('Calibrating Ultra-Low Latency WebSocket Streams...');
        if (next > 85 && prev <= 85) setStatusText('Lumo AI Voice Interface: READY');
        return Math.min(next, 100);
      });
    }, 120);

    return () => clearInterval(interval);
  }, []);

  const handleStart = () => {
    setIsExiting(true);
    setTimeout(() => {
      onComplete();
    }, 800);
  };

  // Auto enter after 3.2s if user doesn't click
  useEffect(() => {
    if (isReady && !isExiting) {
      const autoTimer = setTimeout(() => {
        handleStart();
      }, 1200);
      return () => clearTimeout(autoTimer);
    }
  }, [isReady]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 text-white overflow-hidden transition-all duration-700 ease-in-out ${
        isExiting ? 'opacity-0 scale-125 blur-2xl pointer-events-none' : 'opacity-100 scale-100'
      }`}
    >
      {/* Animated Cyber Grid Matrix Background */}
      <div className="absolute inset-0 bg-cyber-grid opacity-30 animate-pulse-glow pointer-events-none" />

      {/* Laser Scanning Beam */}
      <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-pink-500 to-transparent shadow-[0_0_20px_#ec4899] animate-scan-beam pointer-events-none" />

      {/* Dynamic Ambient Color Orbs */}
      <div className="absolute w-[500px] h-[500px] bg-pink-600/20 rounded-full blur-[120px] animate-pulse-glow" />
      <div className="absolute w-[400px] h-[400px] bg-purple-600/20 rounded-full blur-[100px] animate-spin-slow" />

      {/* Futuristic Sci-Fi HUD Reticle */}
      <div className="relative flex flex-col items-center justify-center z-10 px-6 max-w-lg w-full text-center">
        {/* Rotating Energy HUD Rings */}
        <div className="relative w-48 h-48 mb-8 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border-2 border-dashed border-pink-500/40 animate-spin-slow" />
          <div className="absolute inset-3 rounded-full border border-purple-500/30 animate-spin-reverse" />
          <div className="absolute inset-8 rounded-full border-2 border-pink-400/20 animate-ping" />

          {/* Central Glowing AI Emblem */}
          <div className="relative w-28 h-28 rounded-3xl bg-gradient-to-tr from-pink-500 via-rose-500 to-purple-600 p-0.5 shadow-[0_0_50px_rgba(236,72,153,0.6)] animate-bounce-in">
            <div className="w-full h-full bg-slate-950/90 rounded-[22px] flex items-center justify-center backdrop-blur-sm">
              <Sparkles className="w-14 h-14 text-pink-400 animate-pulse" />
            </div>
          </div>
        </div>

        {/* Title */}
        <h1 className="text-3xl sm:text-4xl font-black tracking-widest uppercase bg-gradient-to-r from-pink-400 via-rose-200 to-purple-400 bg-clip-text text-transparent mb-1 animate-slide-up">
          Lumo AI
        </h1>
        <p className="text-xs sm:text-sm font-semibold tracking-widest text-slate-400 uppercase mb-3">
          Next-Gen Realtime Voice Assistant
        </p>

        {/* Creators & Bosses Badge */}
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-slate-900/90 border border-pink-500/30 text-[11px] font-mono text-pink-300 mb-6 shadow-lg shadow-pink-500/10">
          <span className="text-slate-400">Created by</span>
          <span className="font-bold text-pink-400">👑 Boss 1: Hridesh Thakur</span>
          <span className="text-slate-500">•</span>
          <span className="font-bold text-purple-400">⚡ Boss 2: Hridesh Thakur</span>
        </div>

        {/* Tech Diagnostics Grid */}
        <div className="w-full grid grid-cols-3 gap-2 mb-6 text-[10px] uppercase font-mono text-slate-400">
          <div className="bg-slate-900/80 border border-white/10 p-2 rounded-xl flex items-center justify-center space-x-1">
            <Cpu className="w-3.5 h-3.5 text-pink-400 shrink-0" />
            <span>Neural Core</span>
          </div>
          <div className="bg-slate-900/80 border border-white/10 p-2 rounded-xl flex items-center justify-center space-x-1">
            <Radio className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <span>24kHz PCM</span>
          </div>
          <div className="bg-slate-900/80 border border-white/10 p-2 rounded-xl flex items-center justify-center space-x-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Live Stream</span>
          </div>
        </div>

        {/* Progress Bar Container */}
        <div className="w-full bg-slate-900/90 border border-white/15 rounded-2xl p-3 shadow-2xl backdrop-blur-md mb-6">
          <div className="flex justify-between text-xs font-mono font-bold mb-2">
            <span className="text-pink-300 truncate max-w-[280px]">{statusText}</span>
            <span className="text-purple-300">{progress}%</span>
          </div>
          <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden p-0.5 border border-white/5">
            <div
              className="h-full bg-gradient-to-r from-pink-500 via-rose-400 to-purple-500 rounded-full transition-all duration-200 ease-out shadow-[0_0_12px_#ec4899]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Action Button */}
        {isReady && (
          <button
            onClick={handleStart}
            className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-pink-500 via-rose-500 to-purple-600 text-white font-black text-sm tracking-widest uppercase shadow-[0_0_30px_rgba(236,72,153,0.5)] hover:shadow-[0_0_45px_rgba(236,72,153,0.8)] active:scale-98 transition-all cursor-pointer flex items-center justify-center space-x-2 animate-bounce-in"
          >
            <Zap className="w-4 h-4 fill-current" />
            <span>Enter Neural Matrix</span>
            <Play className="w-4 h-4 fill-current ml-1" />
          </button>
        )}
      </div>
    </div>
  );
};
