export interface AuthSessionPayload {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  sessionId?: string;
  /** @deprecated use sessionId */
  sessionFamilyId?: string;
  apiBase: string;
}

export interface SessionClientInfo {
  clientType: string;
  platform: string;
  appName: string;
  deviceLabel: string;
  userAgent?: string;
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
    getSessionId: () => Promise<string | null>;
    getSessionFamilyId: () => Promise<string | null>;
    getRefreshToken: () => Promise<string | null>;
    syncApiBase: (apiBase: string) => Promise<boolean>;
    hasSession: () => Promise<boolean>;
    clearSession: () => Promise<boolean>;
    refresh: (clientInfo?: SessionClientInfo) => Promise<{
      accessToken: string;
      sessionId?: string;
    } | null>;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
