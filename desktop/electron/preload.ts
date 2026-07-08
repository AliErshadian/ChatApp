import { contextBridge, ipcRenderer, clipboard } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  notify: (title: string, body: string) =>
    ipcRenderer.invoke('notify', { title, body }),
  copyToClipboard: (text: string) => clipboard.writeText(text),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
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
      apiBase: string;
    }) => ipcRenderer.invoke('auth:set-session', session) as Promise<boolean>,
    getAccessToken: () =>
      ipcRenderer.invoke('auth:get-access-token') as Promise<string | null>,
    hasSession: () => ipcRenderer.invoke('auth:has-session') as Promise<boolean>,
    clearSession: () => ipcRenderer.invoke('auth:clear-session') as Promise<boolean>,
    refresh: () =>
      ipcRenderer.invoke('auth:refresh') as Promise<{ accessToken: string } | null>,
  },
});
