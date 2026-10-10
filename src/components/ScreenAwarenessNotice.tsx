// src/components/ScreenAwarenessNotice.tsx
//
// Passive, dismissible banner shown when electron/main/screenAwareness.ts's
// background loop flags something notable (a new error dialog, a
// permission/security prompt, etc.) — see that file's header comment for
// why this never speaks up in the live voice conversation on its own.
// The user sees the banner and can ask about it; Anushka doesn't volunteer
// it out loud.

import React, { useEffect, useState } from 'react';
import { Eye, X } from 'lucide-react';

interface ScreenAwarenessNoticeProps {
  notice: { summary: string; reason?: string; at: number } | null;
  onDismiss: () => void;
}

export const ScreenAwarenessNotice: React.FC<ScreenAwarenessNoticeProps> = ({ notice, onDismiss }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!notice) return;
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      onDismiss();
    }, 10000); // longer than ToolCallToast's 5s — this wasn't asked for, give the user time to notice it
    return () => clearTimeout(timer);
  }, [notice, onDismiss]);

  if (!notice || !visible) return null;

  return (
    <div className="fixed top-20 left-4 sm:left-8 z-50 animate-bounce-in max-w-sm w-full">
      <div className="bg-slate-900/95 border border-sky-500/40 p-4 rounded-2xl shadow-2xl backdrop-blur-xl flex items-start space-x-3 text-slate-100">
        <div className="p-2 rounded-xl bg-slate-800 border border-white/10 shrink-0">
          <Eye className="w-5 h-5 text-sky-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-sky-400 uppercase tracking-wider">Noticed On Screen</span>
            <button
              onClick={() => { setVisible(false); onDismiss(); }}
              className="p-0.5 rounded text-slate-500 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-xs font-semibold text-white">{notice.reason || notice.summary}</p>
          {notice.reason && <p className="text-[11px] text-slate-400 mt-0.5">{notice.summary}</p>}
        </div>
      </div>
    </div>
  );
};
