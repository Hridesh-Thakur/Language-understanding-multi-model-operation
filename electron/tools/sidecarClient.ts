// electron/tools/sidecarClient.ts
//
// Talks to python-sidecar/sidecar.py over stdio using newline-delimited
// JSON-RPC. The sidecar handles everything that needs real Windows APIs:
// mouse/keyboard, window enumeration/move/resize, screenshots, volume,
// brightness, process listing/kill, and detailed system telemetry.

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import { app } from 'electron';
import { randomUUID } from 'crypto';

let proc: ChildProcessWithoutNullStreams | null = null;
let buffer = '';
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();

function sidecarPath(): { cmd: string; args: string[] } {
  // Packaged app: extraResources/python-sidecar/sidecar.exe (PyInstaller onefile)
  // Dev mode: run the .py script with the system Python interpreter.
  if (app.isPackaged) {
    return { cmd: path.join(process.resourcesPath, 'python-sidecar', 'sidecar.exe'), args: [] };
  }
  return { cmd: 'python', args: [path.join(__dirname, '..', '..', 'python-sidecar', 'sidecar.py')] };
}

export function startSidecar(): void {
  if (proc) return;
  const { cmd, args } = sidecarPath();
  proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });

  proc.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        const waiter = pending.get(msg.id);
        if (waiter) {
          pending.delete(msg.id);
          if (msg.error) waiter.reject(new Error(msg.error));
          else waiter.resolve(msg.result);
        }
      } catch {
        // ignore malformed lines (e.g. stray prints from a library)
      }
    }
  });

  proc.stderr.on('data', (chunk: Buffer) => {
    console.error('[sidecar]', chunk.toString('utf-8'));
  });

  proc.on('exit', (code) => {
    console.warn('[sidecar] exited with code', code);
    proc = null;
    // reject anything still in flight
    for (const [, waiter] of pending) waiter.reject(new Error('Sidecar process exited'));
    pending.clear();
  });
}

export function stopSidecar(): void {
  proc?.kill();
  proc = null;
}

export function callSidecar(method: string, params: Record<string, any> = {}, timeoutMs = 15000): Promise<any> {
  if (!proc) startSidecar();
  const id = randomUUID();
  const payload = JSON.stringify({ id, method, params }) + '\n';

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Sidecar call "${method}" timed out`));
    }, timeoutMs);

    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });

    proc!.stdin.write(payload);
  });
}
