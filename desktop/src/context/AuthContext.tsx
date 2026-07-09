import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api, User } from '../services/api';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, displayName: string, password: string) => Promise<void>;
  logout: () => void;
  endSession: () => void;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const BOOTSTRAP_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('Session restore timed out'));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await withTimeout(
          (async () => {
            const hasTokens = await api.loadTokens();
            if (!hasTokens) return;

            const me = await api.restoreSession();
            if (cancelled) return;

            setUser(me);
          })(),
          BOOTSTRAP_TIMEOUT_MS,
        );
      } catch (err) {
        if (!cancelled) {
          const status = (err as { status?: number } | null)?.status;
          if (status === 401) {
            await api.clearTokens();
          }
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.login(email, password);
    await api.setTokens({
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      expiresIn: res.expiresIn,
      sessionId: res.sessionId ?? res.sessionFamilyId,
    });
    setUser(res.user);
  };

  const register = async (email: string, username: string, displayName: string, password: string) => {
    const res = await api.register(email, username, displayName, password);
    await api.setTokens({
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      expiresIn: res.expiresIn,
      sessionId: res.sessionId ?? res.sessionFamilyId,
    });
    setUser(res.user);
  };

  const logout = () => {
    void (async () => {
      await api.logout();
      setUser(null);
    })();
  };

  const endSession = () => {
    void (async () => {
      await api.clearTokens();
      setUser(null);
    })();
  };

  const updateUser = (next: User) => {
    setUser(next);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, endSession, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
