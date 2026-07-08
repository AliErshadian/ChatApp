export interface AuthSessionPayload {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  apiBase: string;
}

export interface ElectronAPI {
  platform: string;
  notify: (title: string, body: string) => Promise<void>;
  copyToClipboard?: (text: string) => Promise<void>;
  openExternal?: (url: string) => Promise<boolean>;
  onInviteLink?: (callback: (url: string) => void) => () => void;
  auth?: {
    setSession: (session: AuthSessionPayload) => Promise<boolean>;
    getAccessToken: () => Promise<string | null>;
    hasSession: () => Promise<boolean>;
    clearSession: () => Promise<boolean>;
    refresh: () => Promise<{ accessToken: string } | null>;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
