// electron/main/logger.ts
//
// One line per executed tool call: timestamp, command/tool, resolved
// target, risk level, permission decision, success/failure, error. Written
// to userData/logs/actions.log (rotated daily by filename). Never logs
// secrets — callers pass in already-sanitized args, and this module itself
// strips a denylist of key names as a second safeguard.

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const SECRET_KEYS = /key|token|secret|password|auth/i;

function logDir(): string {
  return path.join(app.getPath('userData'), 'logs');
}

function logFilePath(): string {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(logDir(), `actions-${day}.log`);
}

function sanitize(args: Record<string, any> | undefined): Record<string, any> {
  if (!args) return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = SECRET_KEYS.test(k) ? '[redacted]' : v;
  }
  return out;
}

export interface LogEntry {
  tool: string;
  args?: Record<string, any>;
  risk?: string;
  decision?: string;
  target?: string;
  success?: boolean;
  error?: string;
}

export function logAction(entry: LogEntry): void {
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      tool: entry.tool,
      args: sanitize(entry.args),
      risk: entry.risk,
      decision: entry.decision,
      target: entry.target,
      success: entry.success,
      error: entry.error,
    });
    fs.appendFileSync(logFilePath(), line + '\n', 'utf-8');
  } catch {
    // Logging must never break the actual tool execution.
  }
}
