import { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain, shell, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import {
  clearAuthSession,
  getAccessToken,
  getRefreshToken,
  getSessionId,
  loadAuthSession,
  saveAuthSession,
  StoredAuthSession,
} from './auth-store';

const isDev = !app.isPackaged;
const APP_PROTOCOL = 'chatapp';
const DEV_APP_URL = 'https://localhost:5173';
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let pendingInviteUrl: string | null = null;

/** Mirrors desktop/csp.ts — keep in sync for packaged Electron builds. */
const DESKTOP_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: http: https:",
  "media-src 'self' blob: http: https:",
  "connect-src 'self' http: https: ws: wss: blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join('; ');

function applyContentSecurityPolicy() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    // Enforce CSP on document navigations and HTML; skip in Vite HMR so Fast Refresh works
    if (!isDev) {
      headers['Content-Security-Policy'] = [DESKTOP_CSP];
    }
    callback({ responseHeaders: headers });
  });
}

interface RefreshClientInfo {
  clientType?: string;
  platform?: string;
  appName?: string;
  deviceLabel?: string;
  userAgent?: string;
}

function formatElectronPlatform(platform: string): string {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return platform;
}

function defaultElectronClientInfo(): RefreshClientInfo {
  const platform = formatElectronPlatform(process.platform);
  return {
    clientType: 'electron',
    platform,
    appName: 'ChatApp',
    deviceLabel: `ChatApp, ${platform}`,
    userAgent: `ChatApp Desktop (${platform})`,
  };
}

let refreshInFlight: Promise<{ accessToken: string; sessionId?: string } | null> | null = null;

function isTrustedSender(event: Electron.IpcMainInvokeEvent): boolean {
  const win = BrowserWindow.fromWebContents(event.sender);
  return !!win && !win.isDestroyed() && win.webContents === event.sender;
}

function resolveAppIconPath(): string | null {
  const candidates = [
    path.join(__dirname, '../build/icon.png'),
    path.join(process.resourcesPath, 'build/icon.png'),
    path.join(process.resourcesPath, 'icon.png'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function loadAppIcon() {
  const iconPath = resolveAppIconPath();
  if (!iconPath) return null;

  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? null : image;
}

ipcMain.handle('notify', (_event, { title, body }: { title: string; body: string }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

ipcMain.handle('open-external', (_event, url: string) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    return shell.openExternal(url);
  }
  return false;
});

ipcMain.handle(
  'auth:set-session',
  (
    event,
    session: {
      accessToken: string;
      refreshToken: string;
      expiresIn?: number;
      sessionId?: string;
      sessionFamilyId?: string;
      apiBase: string;
    },
  ) => {
    if (!isTrustedSender(event)) return false;
    if (
      !session?.accessToken ||
      !session?.refreshToken ||
      !session?.apiBase ||
      typeof session.accessToken !== 'string' ||
      typeof session.refreshToken !== 'string' ||
      typeof session.apiBase !== 'string'
    ) {
      return false;
    }
    saveAuthSession({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresIn: session.expiresIn,
      sessionId: session.sessionId ?? session.sessionFamilyId,
      apiBase: session.apiBase,
    });
    return true;
  },
);

ipcMain.handle('auth:get-access-token', (event) => {
  if (!isTrustedSender(event)) return null;
  return getAccessToken();
});

ipcMain.handle('auth:has-session', (event) => {
  if (!isTrustedSender(event)) return false;
  return !!loadAuthSession();
});

ipcMain.handle('auth:clear-session', (event) => {
  if (!isTrustedSender(event)) return false;
  clearAuthSession();
  return true;
});

ipcMain.handle('auth:sync-api-base', (event, { apiBase }: { apiBase: string }) => {
  if (!isTrustedSender(event)) return false;
  if (!apiBase || typeof apiBase !== 'string') return false;

  const session = loadAuthSession();
  if (!session) return false;

  saveAuthSession({
    ...session,
    apiBase,
  });
  return true;
});

ipcMain.handle('auth:get-session-id', (event) => {
  if (!isTrustedSender(event)) return null;
  return getSessionId();
});

ipcMain.handle('auth:get-session-family-id', (event) => {
  if (!isTrustedSender(event)) return null;
  return getSessionId();
});

ipcMain.handle('auth:get-refresh-token', (event) => {
  if (!isTrustedSender(event)) return null;
  return getRefreshToken();
});

ipcMain.handle('auth:refresh', async (event, clientInfo?: RefreshClientInfo) => {
  if (!isTrustedSender(event)) return null;

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const session = loadAuthSession();
      if (!session) return null;

      const info = clientInfo ?? defaultElectronClientInfo();

      try {
        const res = await fetch(`${session.apiBase}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            refreshToken: session.refreshToken,
            clientInfo: info,
          }),
        });
        if (!res.ok) {
          // Only clear if the stored token was rejected (not on transient server errors).
          if (res.status === 401 || res.status === 403) {
            clearAuthSession();
          }
          return null;
        }

        const data = (await res.json()) as {
          accessToken: string;
          refreshToken: string;
          expiresIn?: number;
          sessionId?: string;
          sessionFamilyId?: string;
        };

        if (!data?.accessToken || !data?.refreshToken) {
          return null;
        }

        const sessionId = data.sessionId ?? data.sessionFamilyId ?? session.sessionId ?? session.sessionFamilyId;

        const next: StoredAuthSession = {
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          expiresIn: data.expiresIn,
          sessionId,
          apiBase: session.apiBase,
        };
        saveAuthSession(next);
        return { accessToken: next.accessToken, sessionId: next.sessionId };
      } catch {
        // Network / parse errors: keep session so the user is not logged out on reload.
        return null;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
});

function extractInviteUrl(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${APP_PROTOCOL}://`)) ?? null;
}

function sendInviteToRenderer(url: string) {
  const win = mainWindow;
  if (!win || win.isDestroyed()) {
    pendingInviteUrl = url;
    return;
  }

  win.webContents.send('invite-link', url);
  win.show();
  win.focus();
}

function handleInviteUrl(url: string) {
  if (!url.startsWith(`${APP_PROTOCOL}://`)) return;
  sendInviteToRenderer(url);
}

function flushPendingInvite() {
  if (!pendingInviteUrl || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('invite-link', pendingInviteUrl);
  pendingInviteUrl = null;
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const inviteUrl = extractInviteUrl(argv);
    if (inviteUrl) handleInviteUrl(inviteUrl);
    mainWindow?.show();
    mainWindow?.focus();
  });
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(APP_PROTOCOL);
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleInviteUrl(url);
});

function createWindow() {
  const iconPath = resolveAppIconPath();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ChatApp',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL(DEV_APP_URL);
    if (process.env.CHATAPP_OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.on('did-finish-load', flushPendingInvite);

  mainWindow.on('close', (e) => {
    if (process.platform !== 'darwin') {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray() {
  const appIcon = loadAppIcon();
  const trayIcon =
    appIcon?.resize({ width: 16, height: 16 }) ??
    appIcon ??
    nativeImage.createEmpty();
  tray = new Tray(trayIcon);
  tray.setToolTip('ChatApp');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow?.show() },
    { label: 'Quit', click: () => { mainWindow?.destroy(); app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow?.show());
}

app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
  if (isDev && url.startsWith(DEV_APP_URL)) {
    event.preventDefault();
    callback(true);
    return;
  }
  callback(false);
});

app.whenReady().then(() => {
  applyContentSecurityPolicy();

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media';
  });

  createWindow();
  createTray();

  const startupInviteUrl = extractInviteUrl(process.argv);
  if (startupInviteUrl) handleInviteUrl(startupInviteUrl);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

export function showNotification(title: string, body: string) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}
