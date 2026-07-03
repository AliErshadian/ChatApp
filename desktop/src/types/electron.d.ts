export interface ElectronAPI {
  platform: string;
  notify: (title: string, body: string) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
