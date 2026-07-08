import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface StoredAuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  /** API base used by main-process refresh (e.g. http://localhost:3000/api/v1) */
  apiBase: string;
}

const STORE_FILE = 'auth-session.bin';

function storePath() {
  return path.join(app.getPath('userData'), STORE_FILE);
}

function canEncrypt() {
  return safeStorage.isEncryptionAvailable();
}

export function saveAuthSession(session: StoredAuthSession): void {
  const payload = Buffer.from(JSON.stringify(session), 'utf8');
  const encoded = canEncrypt()
    ? safeStorage.encryptString(payload.toString('utf8'))
    : payload;
  fs.writeFileSync(storePath(), encoded);
}

export function loadAuthSession(): StoredAuthSession | null {
  const file = storePath();
  if (!fs.existsSync(file)) return null;

  try {
    const raw = fs.readFileSync(file);
    const json = canEncrypt()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8');
    const parsed = JSON.parse(json) as StoredAuthSession;
    if (!parsed?.accessToken || !parsed?.refreshToken || !parsed?.apiBase) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearAuthSession(): void {
  const file = storePath();
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

export function getAccessToken(): string | null {
  return loadAuthSession()?.accessToken ?? null;
}
