import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api, User } from '../services/api';
import { realtime } from '../services/realtime';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, displayName: string, password: string) => Promise<void>;
  logout: () => void;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const hasTokens = await api.loadTokens();
        if (!hasTokens) {
          if (!cancelled) setLoading(false);
          return;
        }
        if (cancelled) return;

        // Ensure we have a usable access token after reload (access TTL is short).
        await api.refresh();
        if (cancelled) return;

        const me = await api.me();
        if (cancelled) return;
        setUser(me);
        realtime.connect();
      } catch (err) {
        // Never wipe session from a Strict Mode remount / aborted bootstrap,
        // and don't logout on transient network failures.
        if (!cancelled) {
          const status = (err as { status?: number } | null)?.status;
          if (status === 401) {
            await api.clearTokens();
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      realtime.disconnect();
    };
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.login(email, password);
    await api.setTokens(res);
    setUser(res.user);
    realtime.connect();
  };

  const register = async (email: string, username: string, displayName: string, password: string) => {
    const res = await api.register(email, username, displayName, password);
    await api.setTokens(res);
    setUser(res.user);
    realtime.connect();
  };

  const logout = () => {
    void (async () => {
      realtime.disconnect();
      await api.clearTokens();
      setUser(null);
    })();
  };

  const updateUser = (next: User) => {
    setUser(next);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
