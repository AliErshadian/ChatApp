import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface StoredAuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  sessionId?: string;
  /** @deprecated use sessionId */
  sessionFamilyId?: string;
  /** API base used by main-process refresh (e.g. http://localhost:3000/api/v1) */
  apiBase: string;
}

const STORE_FILE = 'auth-session.bin';
/** Marks that the following bytes were produced by safeStorage.encryptString */
const ENC_MAGIC = Buffer.from('CA1E');

function storePath() {
  return path.join(app.getPath('userData'), STORE_FILE);
}

function canEncrypt() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function saveAuthSession(session: StoredAuthSession): void {
  const sessionId = session.sessionId ?? session.sessionFamilyId;
  const json = JSON.stringify({
    ...session,
    sessionId,
    sessionFamilyId: undefined,
  });
  if (canEncrypt()) {
    const encrypted = safeStorage.encryptString(json);
    fs.writeFileSync(storePath(), Buffer.concat([ENC_MAGIC, encrypted]));
    return;
  }
  fs.writeFileSync(storePath(), Buffer.from(json, 'utf8'));
}

function parseSession(json: string): StoredAuthSession | null {
  try {
    const parsed = JSON.parse(json) as StoredAuthSession;
    if (!parsed?.accessToken || !parsed?.refreshToken || !parsed?.apiBase) {
      return null;
    }
    const sessionId = parsed.sessionId ?? parsed.sessionFamilyId;
    return sessionId ? { ...parsed, sessionId } : parsed;
  } catch {
    return null;
  }
}

export function loadAuthSession(): StoredAuthSession | null {
  const file = storePath();
  if (!fs.existsSync(file)) return null;

  try {
    const raw = fs.readFileSync(file);

    // Preferred format: magic header + encrypted payload
    if (raw.length > ENC_MAGIC.length && raw.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC)) {
      const body = raw.subarray(ENC_MAGIC.length);
      if (!canEncrypt()) return null;
      return parseSession(safeStorage.decryptString(body));
    }

    // Legacy / plaintext fallback (also covers older encrypted blobs without magic)
    const asUtf8 = raw.toString('utf8');
    const plain = parseSession(asUtf8);
    if (plain) return plain;

    if (canEncrypt()) {
      try {
        return parseSession(safeStorage.decryptString(raw));
      } catch {
        return null;
      }
    }

    return null;
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

export function getRefreshToken(): string | null {
  return loadAuthSession()?.refreshToken ?? null;
}

export function getSessionId(): string | null {
  const session = loadAuthSession();
  return session?.sessionId ?? session?.sessionFamilyId ?? null;
}
