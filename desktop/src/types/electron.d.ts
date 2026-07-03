export interface ElectronAPI {
  platform: string;
  notify: (title: string, body: string) => Promise<void>;
  copyToClipboard?: (text: string) => Promise<void>;
  openExternal?: (url: string) => Promise<boolean>;
  onInviteLink?: (callback: (url: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
