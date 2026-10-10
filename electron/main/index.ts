// electron/main/index.ts
import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import { executeTool, resolveConfirmation, requestEmergencyStop, clearEmergencyStop } from '../tools/registry';
import { startSidecar, stopSidecar } from '../tools/sidecarClient';
import { getSettings, updateSettings } from '../security/settings';
import { startScreenAwarenessLoop, stopScreenAwarenessLoop } from './screenAwareness';
import { startSchedulerLoop, stopSchedulerLoop } from './scheduler';

const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:3000';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function iconPath(): string {
  return path.join(__dirname, '..', '..', 'build', 'icon.png');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 820,
    minWidth: 380,
    minHeight: 640,
    frame: false,          // keep the existing zero-chrome holographic look
    transparent: true,
    backgroundColor: '#00000000',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(process.resourcesPath, 'app', 'dist', 'index.html'));
  }

  // Minimize-to-tray instead of quitting, so the wake-word / voice loop can
  // keep running in the background (see section 32 of the spec).
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray() {
  const image = nativeImage.createFromPath(iconPath());
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  const menu = Menu.buildFromTemplate([
    { label: 'Show Lumo', click: () => mainWindow?.show() },
    { label: 'Hide Lumo', click: () => mainWindow?.hide() },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    {
      label: 'Screen Awareness (periodic, sends screenshots to Gemini)',
      type: 'checkbox',
      checked: getSettings().screenAwarenessEnabled,
      click: (item) => updateSettings({ screenAwarenessEnabled: item.checked }),
    },
    { type: 'separator' },
    { label: 'Emergency Stop ("Lumo stop")', click: () => requestEmergencyStop() },
    { label: 'Resume', click: () => clearEmergencyStop() },
    { type: 'separator' },
    { label: 'Exit', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setToolTip('Lumo AI');
  tray.setContextMenu(menu);
  tray.on('click', () => mainWindow?.show());
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  startSidecar();
  // The loop itself checks settings.screenAwarenessEnabled on every tick,
  // so starting it here doesn't mean it's actually capturing anything —
  // it just means it's ready the moment the user turns the setting on,
  // with no restart needed.
  if (mainWindow) startScreenAwarenessLoop(mainWindow);
  // Scheduled/timed automation (Pass 11) — same "start the loop, it's a
  // no-op until there's a due task" shape as screen awareness above.
  if (mainWindow) startSchedulerLoop(mainWindow);

  // --- IPC: tool invocation from the renderer (already vetted by the
  // renderer's OS_TOOL_NAMES allowlist in src/lib/liveSession.ts, and
  // re-checked here by the risk policy regardless). ---
  ipcMain.handle('anushka:invoke-tool', async (_evt, { tool, args }) => {
    if (!mainWindow) return { success: false, error: 'No window' };
    return executeTool(mainWindow, tool, args ?? {});
  });

  ipcMain.on('anushka:confirm-response', (_evt, { id, approved }) => {
    resolveConfirmation(id, approved);
  });

  ipcMain.on('anushka:emergency-stop', () => requestEmergencyStop());
  ipcMain.on('anushka:resume', () => clearEmergencyStop());

  ipcMain.handle('anushka:get-startup', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.on('anushka:set-startup', (_evt, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
  });

  // Trusted Mode + other persisted settings (electron/security/settings.ts).
  // registry.ts reads isTrustedMode() directly from the same module at
  // execution time, so a toggle here takes effect on the very next command.
  ipcMain.handle('anushka:get-settings', () => getSettings());
  ipcMain.handle('anushka:update-settings', (_evt, patch: Record<string, any>) => updateSettings(patch ?? {}));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => { isQuitting = true; stopScreenAwarenessLoop(); stopSchedulerLoop(); stopSidecar(); });
app.on('window-all-closed', () => {
  // Background mode: don't quit when the window closes, only via tray Exit.
  if (process.platform !== 'darwin') {
    // no-op: stay alive in tray
  }
});
