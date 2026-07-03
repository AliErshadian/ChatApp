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
});
