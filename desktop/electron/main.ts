import { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain, shell } from 'electron';
import * as path from 'path';

const isDev = !app.isPackaged;
const APP_PROTOCOL = 'chatapp';
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let pendingInviteUrl: string | null = null;

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
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ChatApp',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
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
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('ChatApp');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow?.show() },
    { label: 'Quit', click: () => { mainWindow?.destroy(); app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow?.show());
}

app.whenReady().then(() => {
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
