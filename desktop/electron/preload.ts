import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  notify: (title: string, body: string) =>
    ipcRenderer.invoke('notify', { title, body }),
});
