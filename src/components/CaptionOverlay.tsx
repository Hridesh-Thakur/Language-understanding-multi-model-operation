import React, { useEffect, useRef } from 'react';
import { MessageSquare, X, User, Sparkles } from 'lucide-react';
import { TranscriptItem } from '../types';

interface CaptionOverlayProps {
  transcripts: TranscriptItem[];
  isOpen: boolean;
  onClose: () => void;
}

export const CaptionOverlay: React.FC<CaptionOverlayProps> = ({
  transcripts,
  isOpen,
  onClose,
}) => {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcripts, isOpen]);

  if (!isOpen) {
    // Show minimalist latest spoken caption banner at the bottom if closed
    const latestAnushka = [...transcripts].reverse().find((t) => t.source === 'anushka');
    if (!latestAnushka) return null;

    return (
      <div className="fixed bottom-24 inset-x-4 max-w-lg mx-auto z-20 pointer-events-none animate-fade-in">
        <div className="bg-slate-950/80 border border-pink-500/30 px-4 py-2.5 rounded-2xl backdrop-blur-md shadow-2xl flex items-center space-x-3">
          <Sparkles className="w-4 h-4 text-pink-400 shrink-0" />
          <p className="text-xs text-slate-200 line-clamp-2 font-medium italic">
            "{latestAnushka.text}"
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-4 bottom-24 sm:bottom-28 max-w-xl mx-auto z-30 animate-slide-up">
      <div className="bg-slate-900/95 border border-white/15 rounded-3xl p-4 shadow-2xl backdrop-blur-2xl flex flex-col max-h-80 min-h-[16rem]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
          <div className="flex items-center space-x-2">
            <MessageSquare className="w-4 h-4 text-pink-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Live Voice Captions
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Transcript Feed */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-thin scrollbar-thumb-slate-700">
          {transcripts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-slate-500 text-xs">
              <Sparkles className="w-6 h-6 mb-2 text-pink-400/50 animate-pulse" />
              <span>Speak to Lumo to see live captions...</span>
            </div>
          ) : (
            transcripts.map((item) => (
              <div
                key={item.id}
                className={`flex items-start space-x-2.5 text-xs ${
                  item.source === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {item.source === 'anushka' && (
                  <div className="w-6 h-6 rounded-full bg-pink-500/20 border border-pink-500/40 flex items-center justify-center shrink-0">
                    <Sparkles className="w-3 h-3 text-pink-300" />
                  </div>
                )}

                <div
                  className={`p-3 rounded-2xl max-w-[82%] ${
                    item.source === 'user'
                      ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-tr-none'
                      : 'bg-slate-800/90 text-slate-100 border border-white/10 rounded-tl-none font-medium'
                  }`}
                >
                  <p>{item.text}</p>
                  <span className="text-[9px] opacity-60 mt-1 block text-right">
                    {new Date(item.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>

                {item.source === 'user' && (
                  <div className="w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center shrink-0">
                    <User className="w-3 h-3 text-purple-300" />
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
};
