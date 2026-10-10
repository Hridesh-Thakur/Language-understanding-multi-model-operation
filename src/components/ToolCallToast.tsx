import React, { useEffect, useState } from 'react';
import { ExternalLink, Palette, Clock, Sparkles, CheckCircle2 } from 'lucide-react';
import { ToolCallItem } from '../types';

interface ToolCallToastProps {
  toolCall: ToolCallItem | null;
}

export const ToolCallToast: React.FC<ToolCallToastProps> = ({ toolCall }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (toolCall) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [toolCall]);

  if (!toolCall || !visible) return null;

  const getToolIcon = () => {
    switch (toolCall.name) {
      case 'openWebsite':
        return <ExternalLink className="w-5 h-5 text-sky-400" />;
      case 'setMoodTheme':
        return <Palette className="w-5 h-5 text-pink-400" />;
      case 'getSystemInfo':
        return <Clock className="w-5 h-5 text-emerald-400" />;
      case 'showConfettiOrEffect':
        return <Sparkles className="w-5 h-5 text-amber-400" />;
      default:
        return <CheckCircle2 className="w-5 h-5 text-purple-400" />;
    }
  };

  return (
    <div className="fixed top-20 right-4 sm:right-8 z-50 animate-bounce-in max-w-sm w-full">
      <div className="bg-slate-900/95 border border-pink-500/40 p-4 rounded-2xl shadow-2xl backdrop-blur-xl flex items-start space-x-3 text-slate-100">
        <div className="p-2 rounded-xl bg-slate-800 border border-white/10 shrink-0">
          {getToolIcon()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-pink-400 uppercase tracking-wider">
              Lumo Executed Action
            </span>
            <span className="text-[10px] text-slate-500">Just now</span>
          </div>
          <p className="text-xs font-semibold text-white truncate">
            {toolCall.name === 'openWebsite'
              ? `Opening: ${toolCall.args.url}`
              : toolCall.resultSummary}
          </p>
          {toolCall.args.title && (
            <p className="text-[11px] text-slate-400 mt-0.5">{toolCall.args.title}</p>
          )}
        </div>
      </div>
    </div>
  );
};
