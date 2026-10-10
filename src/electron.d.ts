export {};

declare global {
  interface Window {
    anushka?: {
      isElectron: true;
      invokeTool: (tool: string, args?: Record<string, any>) => Promise<any>;
      onConfirmRequest: (
        cb: (payload: { id: string; tool: string; args: any; risk: 'low' | 'medium' | 'high' }) => void
      ) => () => void;
      sendConfirmResponse: (id: string, approved: boolean) => void;
      emergencyStop: () => void;
      resume: () => void;
      getStartupEnabled: () => Promise<boolean>;
      setStartupEnabled: (enabled: boolean) => void;
      getSettings: () => Promise<{
        trustedMode: boolean;
        voiceLanguage: string;
        alwaysListening: boolean;
        screenAwarenessEnabled: boolean;
        screenAwarenessIntervalSec: number;
      }>;
      updateSettings: (patch: Record<string, any>) => Promise<{
        trustedMode: boolean;
        voiceLanguage: string;
        alwaysListening: boolean;
        screenAwarenessEnabled: boolean;
        screenAwarenessIntervalSec: number;
      }>;
      onScreenNotableChange: (
        cb: (payload: { summary: string; reason?: string; at: number }) => void
      ) => () => void;
      onScheduledTaskNotice: (
        cb: (payload: { id: string; label: string; outcome: 'ran' | 'failed' | 'skipped'; reason?: string; at: number }) => void
      ) => () => void;
    };
  }
}
