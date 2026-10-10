// electron/main/scheduler.ts
//
// A new TRIGGER SOURCE for the same execution path every other tool call
// already uses — not a new execution path. A due task dispatches through
// executeTool(win, 'run_macro'|'run_automation', ...) in registry.ts,
// exactly like a live voice command would, so a scheduled destructive step
// still gets its normal risk-tier treatment.
//
// Lives in the Electron MAIN process (like screenAwareness.ts's loop), not
// in the renderer/Live session, because the Live voice session isn't
// connected 24/7 but this timer needs to be.
//
// --- The unattended-confirmation design problem ---
// registry.ts's askForConfirmation() auto-denies after 30s of silence. A
// scheduled task firing at 3am with nobody at the keyboard would silently
// fail every time if it contained a step needing confirmation. Rather than
// add a confirmation bypass for scheduled runs generally (which would
// quietly undercut the centralized confirmation system every other pass in
// this project has kept honest), this is resolved explicitly:
//
//   (a) DEFAULT (allowUnattendedConfirm: false): before dispatching, check
//       whether every step in the task would run WITHOUT a confirmation
//       prompt right now (checkPermission() !== 'CONFIRM', given the
//       current Trusted Mode + risk tier). If any step would need to
//       confirm, the run is SKIPPED and logged, and a passive notice is
//       sent to the renderer — reusing the same 'anushka:screen-notable-
//       change'-style passive IPC pattern screenAwareness.ts already uses,
//       not a second notification mechanism. Never block-then-silently-
//       fail — 30s of a real confirmation timing out with nobody there.
//   (b) OPT-IN (allowUnattendedConfirm: true): set once, explicitly, when
//       the schedule is created (never by the model on its own initiative —
//       see the server.ts system-instruction bullet). When true, the task
//       dispatches even if a step would need to confirm; executeTool()'s
//       own askForConfirmation() will then auto-deny that specific step
//       after 30s exactly as it does today — this flag does not bypass
//       confirmation, it only allows the run to START instead of being
//       skipped up front. (A future pass could special-case this further;
//       out of scope here — see UPGRADE_NOTES.md.)

import { BrowserWindow } from 'electron';
import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { checkPermission } from '../security/riskPolicy';
import { isTrustedMode } from '../security/settings';
import { logAction } from './logger';
import type { MacroStep } from '../tools/nodeTools';

export type ScheduleTrigger =
  | { type: 'once'; atEpochMs: number }
  | { type: 'daily'; hour: number; minute: number }
  | { type: 'weekly'; weekday: number; hour: number; minute: number } // 0=Sun..6=Sat
  | { type: 'interval'; everyMinutes: number };

export type ScheduleAction =
  | { kind: 'macro'; name: string }
  | { kind: 'steps'; steps: MacroStep[] };

export interface ScheduledTask {
  id: string;
  label: string;
  trigger: ScheduleTrigger;
  action: ScheduleAction;
  enabled: boolean;
  allowUnattendedConfirm: boolean; // default false — see design note above
  lastRunAt?: number;
  nextRunAt: number;
}

function schedulesFilePath(): string {
  return path.join(app.getPath('userData'), 'scheduledTasks.json');
}

let cache: ScheduledTask[] | null = null;

export async function loadSchedules(): Promise<ScheduledTask[]> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(schedulesFilePath(), 'utf-8');
    cache = JSON.parse(raw);
  } catch {
    cache = [];
  }
  return cache!;
}

async function saveSchedules(tasks: ScheduledTask[]): Promise<void> {
  cache = tasks;
  await fs.mkdir(path.dirname(schedulesFilePath()), { recursive: true });
  await fs.writeFile(schedulesFilePath(), JSON.stringify(tasks, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// nextRunAt computation
// ---------------------------------------------------------------------------
function computeNextRunAt(trigger: ScheduleTrigger, from: Date = new Date()): number {
  if (trigger.type === 'once') return trigger.atEpochMs;

  if (trigger.type === 'interval') {
    return from.getTime() + Math.max(1, trigger.everyMinutes) * 60000;
  }

  if (trigger.type === 'daily') {
    const next = new Date(from);
    next.setHours(trigger.hour, trigger.minute, 0, 0);
    if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
    return next.getTime();
  }

  // weekly
  const next = new Date(from);
  next.setHours(trigger.hour, trigger.minute, 0, 0);
  let dayDiff = (trigger.weekday - next.getDay() + 7) % 7;
  if (dayDiff === 0 && next.getTime() <= from.getTime()) dayDiff = 7;
  next.setDate(next.getDate() + dayDiff);
  return next.getTime();
}

// ---------------------------------------------------------------------------
// CRUD tools (mirrors create_macro/list_macros/delete_macro's shape and
// error-message style).
// ---------------------------------------------------------------------------
export async function createScheduledTask(args: {
  label: string;
  trigger: ScheduleTrigger;
  action: ScheduleAction;
  allowUnattendedConfirm?: boolean;
}): Promise<{ success: boolean; tool: string; id?: string; nextRunAt?: number; error?: string }> {
  if (!args?.label || !args?.trigger || !args?.action) {
    return { success: false, tool: 'create_scheduled_task', error: 'A label, trigger, and action are required.' };
  }
  if (args.action.kind === 'steps' && (!Array.isArray(args.action.steps) || args.action.steps.length === 0)) {
    return { success: false, tool: 'create_scheduled_task', error: 'An ad-hoc scheduled action needs at least one step.' };
  }
  if (args.action.kind === 'macro' && !args.action.name) {
    return { success: false, tool: 'create_scheduled_task', error: 'A macro action needs a macro name.' };
  }

  const tasks = await loadSchedules();
  const nextRunAt = computeNextRunAt(args.trigger);
  const task: ScheduledTask = {
    id: `sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label: args.label,
    trigger: args.trigger,
    action: args.action,
    enabled: true,
    // Never implicitly true — a caller must explicitly pass true. This is
    // also enforced by instruction (server.ts): the model should never set
    // this on its own initiative.
    allowUnattendedConfirm: Boolean(args.allowUnattendedConfirm),
    nextRunAt,
  };
  tasks.push(task);
  await saveSchedules(tasks);
  return { success: true, tool: 'create_scheduled_task', id: task.id, nextRunAt: task.nextRunAt };
}

export async function listScheduledTasks(): Promise<{ success: boolean; tool: string; tasks: ScheduledTask[] }> {
  const tasks = await loadSchedules();
  return { success: true, tool: 'list_scheduled_tasks', tasks };
}

export async function deleteScheduledTask(args: { id?: string; label?: string }): Promise<{ success: boolean; tool: string; deleted: boolean }> {
  const tasks = await loadSchedules();
  const next = tasks.filter((t) => {
    if (args?.id) return t.id !== args.id;
    if (args?.label) return t.label.toLowerCase() !== args.label.toLowerCase();
    return true;
  });
  await saveSchedules(next);
  return { success: true, tool: 'delete_scheduled_task', deleted: next.length !== tasks.length };
}

// ---------------------------------------------------------------------------
// Background tick loop — copies screenAwareness.ts's "cheap check, only act
// when something's due" shape. Tick every ~30s; only due tasks do real work.
// ---------------------------------------------------------------------------
let win: BrowserWindow | null = null;
let timer: NodeJS.Timeout | null = null;
let ticking = false; // reentrancy guard, same as screenAwareness.ts

const TICK_MS = 30000;

// Would every step in this task run right now WITHOUT a confirmation
// prompt, given current Trusted Mode + each step's risk tier? Steps
// resolved from a saved macro are checked the same way as ad-hoc steps —
// this only ever READS the risk policy, it never changes what it decides.
async function wouldRunUnattended(action: ScheduleAction): Promise<boolean> {
  const trusted = isTrustedMode();
  let steps: MacroStep[];
  if (action.kind === 'steps') {
    steps = action.steps;
  } else {
    // Lazy import to avoid a require-cycle at module load time (nodeTools.ts
    // imports webAutomation.ts etc.; scheduler.ts only needs loadMacros).
    const { loadMacros } = await import('../tools/nodeTools');
    const macros = await loadMacros();
    const macro = macros.find((m) => m.name.toLowerCase() === action.name.toLowerCase());
    if (!macro) return false; // missing macro — let the real dispatch report the error
    steps = macro.steps;
  }
  return steps.every((s) => checkPermission(s.tool, s.args ?? {}, trusted) !== 'CONFIRM');
}

async function runDueTask(task: ScheduledTask): Promise<void> {
  if (!win || win.isDestroyed()) return;

  if (!task.allowUnattendedConfirm) {
    const clear = await wouldRunUnattended(task.action);
    if (!clear) {
      logAction({
        tool: 'scheduled_task_skipped',
        args: { id: task.id, label: task.label },
        risk: 'low',
        decision: 'ALLOW',
        success: false,
        error: 'Skipped: contains a step that would need confirmation and allowUnattendedConfirm is off.',
      });
      win.webContents.send('anushka:scheduled-task-notice', {
        id: task.id,
        label: task.label,
        outcome: 'skipped',
        reason: 'This scheduled task needs a confirmation it can\'t get unattended, so it was skipped. Turn on "allow unattended" for this schedule if you want it to run anyway.',
        at: Date.now(),
      });
      return;
    }
  }

  // Same call a live voice command would make — no separate execution path.
  const { executeTool } = await import('../tools/registry');
  const result = task.action.kind === 'macro'
    ? await executeTool(win, 'run_macro', { name: task.action.name })
    : await executeTool(win, 'run_automation', { steps: task.action.steps, label: task.label });

  win.webContents.send('anushka:scheduled-task-notice', {
    id: task.id,
    label: task.label,
    outcome: result?.success === false ? 'failed' : 'ran',
    at: Date.now(),
  });
}

async function tick() {
  if (ticking) return;
  if (!win || win.isDestroyed()) return;
  ticking = true;
  try {
    const tasks = await loadSchedules();
    const now = Date.now();
    let changed = false;

    for (const task of tasks) {
      if (!task.enabled || task.nextRunAt > now) continue;

      await runDueTask(task);
      task.lastRunAt = now;
      if (task.trigger.type === 'once') {
        task.enabled = false;
      } else {
        task.nextRunAt = computeNextRunAt(task.trigger, new Date(now));
      }
      changed = true;
    }

    if (changed) await saveSchedules(tasks);
  } catch (err: any) {
    logAction({ tool: 'scheduler_tick', args: {}, risk: 'low', decision: 'ALLOW', success: false, error: err?.message || String(err) });
  } finally {
    ticking = false;
  }
}

export function startSchedulerLoop(mainWindow: BrowserWindow) {
  win = mainWindow;
  if (timer) return; // already running
  timer = setInterval(tick, TICK_MS);
}

export function stopSchedulerLoop() {
  if (timer) clearInterval(timer);
  timer = null;
}
