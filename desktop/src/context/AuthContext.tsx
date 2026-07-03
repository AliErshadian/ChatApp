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
    if (api.loadTokens()) {
      api.me()
        .then((u) => {
          setUser(u);
          realtime.connect();
        })
        .catch(() => api.clearTokens())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
    return () => realtime.disconnect();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.login(email, password);
    api.setTokens(res);
    setUser(res.user);
    realtime.connect();
  };

  const register = async (email: string, username: string, displayName: string, password: string) => {
    const res = await api.register(email, username, displayName, password);
    api.setTokens(res);
    setUser(res.user);
    realtime.connect();
  };

  const logout = () => {
    realtime.disconnect();
    api.clearTokens();
    setUser(null);
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
