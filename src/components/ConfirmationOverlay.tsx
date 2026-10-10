import React from 'react';
import { AlertTriangle, ShieldAlert, Check, X } from 'lucide-react';

interface Props {
  tool: string;
  risk: 'low' | 'medium' | 'high';
  onApprove: () => void;
  onDeny: () => void;
}

const RISK_COLOR: Record<string, string> = {
  low: '#10b981',
  medium: '#f59e0b',
  high: '#ef4444',
};

// Stays consistent with the app's zero-text philosophy: the icon + color
// carries the state, a single short label names the action (unavoidable —
// the user must know exactly what they're approving), two icon buttons
// carry the choice. Say "yes" / "no" also works — wired in App.tsx.
export function ConfirmationOverlay({ tool, risk, onApprove, onDeny }: Props) {
  const color = RISK_COLOR[risk];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div
        className="flex flex-col items-center gap-4 rounded-2xl px-8 py-7 border"
        style={{ borderColor: color, boxShadow: `0 0 40px ${color}55`, background: 'rgba(10,10,15,0.9)' }}
      >
        <div className="animate-pulse" style={{ color }}>
          {risk === 'high' ? <ShieldAlert size={40} /> : <AlertTriangle size={40} />}
        </div>
        <div className="text-sm tracking-wide text-white/80">{tool.replace(/_/g, ' ')}</div>
        <div className="flex gap-4">
          <button
            onClick={onApprove}
            className="rounded-full p-3 bg-emerald-500/20 hover:bg-emerald-500/40 transition"
            aria-label="Approve"
          >
            <Check className="text-emerald-400" size={22} />
          </button>
          <button
            onClick={onDeny}
            className="rounded-full p-3 bg-red-500/20 hover:bg-red-500/40 transition"
            aria-label="Deny"
          >
            <X className="text-red-400" size={22} />
          </button>
        </div>
      </div>
    </div>
  );
}
