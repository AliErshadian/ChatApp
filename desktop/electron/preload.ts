import { contextBridge, ipcRenderer, clipboard } from 'electron';

interface RefreshClientInfo {
  clientType: string;
  platform: string;
  appName: string;
  deviceLabel: string;
  userAgent?: string;
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  notify: (title: string, body: string) =>
    ipcRenderer.invoke('notify', { title, body }),
  copyToClipboard: (text: string) => clipboard.writeText(text),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  listScreenSources: (options?: { types?: Array<'screen' | 'window'> }) =>
    ipcRenderer.invoke('screen:list-sources', options) as Promise<
      Array<{
        id: string;
        name: string;
        displayId: string;
        kind: 'screen' | 'window';
        thumbnailDataUrl: string;
        appIconDataUrl: string | null;
      }>
    >,
  onInviteLink: (callback: (url: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => callback(url);
    ipcRenderer.on('invite-link', listener);
    return () => ipcRenderer.removeListener('invite-link', listener);
  },
  auth: {
    setSession: (session: {
      accessToken: string;
      refreshToken: string;
      expiresIn?: number;
      sessionId?: string;
      sessionFamilyId?: string;
      apiBase: string;
    }) => ipcRenderer.invoke('auth:set-session', session) as Promise<boolean>,
    getAccessToken: () =>
      ipcRenderer.invoke('auth:get-access-token') as Promise<string | null>,
    getSessionId: () =>
      ipcRenderer.invoke('auth:get-session-id') as Promise<string | null>,
    getSessionFamilyId: () =>
      ipcRenderer.invoke('auth:get-session-family-id') as Promise<string | null>,
    getRefreshToken: () =>
      ipcRenderer.invoke('auth:get-refresh-token') as Promise<string | null>,
    syncApiBase: (apiBase: string) =>
      ipcRenderer.invoke('auth:sync-api-base', { apiBase }) as Promise<boolean>,
    hasSession: () => ipcRenderer.invoke('auth:has-session') as Promise<boolean>,
    clearSession: () => ipcRenderer.invoke('auth:clear-session') as Promise<boolean>,
    refresh: (clientInfo?: RefreshClientInfo) =>
      ipcRenderer.invoke('auth:refresh', clientInfo) as Promise<{
        accessToken: string;
        sessionId?: string;
      } | null>,
  },
});
