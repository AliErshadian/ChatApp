import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { realtime, type AvatarPresence } from '../services/realtime';
import { api } from '../services/api';
import { useAuth } from './AuthContext';

export type { AvatarPresence };

interface PresenceContextValue {
  getPresence: (userId: string | undefined) => AvatarPresence | undefined;
  getLastSeen: (userId: string | undefined) => string | undefined;
  refreshPresence: (userIds: string[]) => void;
}

const PresenceContext = createContext<PresenceContextValue | null>(null);

const PRESENCE_REFRESH_MS = 30_000;

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user, endSession } = useAuth();
  const trackedIdsRef = useRef<string[]>([]);
  const [presenceVersion, setPresenceVersion] = useState(0);

  const refreshPresence = useCallback(
    (userIds: string[]) => {
      const ids = [...new Set(userIds)].filter((id) => id && id !== user?.id);
      if (ids.length === 0) return;

      trackedIdsRef.current = [...new Set([...trackedIdsRef.current, ...ids])];
      void realtime.queryPresence(ids).catch(() => {
        // Retried automatically when the socket connects.
      });
    },
    [user?.id],
  );

  const bumpPresence = useCallback(() => {
    setPresenceVersion((version) => version + 1);
  }, []);

  useLayoutEffect(() => {
    realtime.connect();
  }, [user?.id]);

  useEffect(() => {
    return () => {
      realtime.disconnect();
    };
  }, []);

  useEffect(() => {
    const unsubscribePresence = realtime.onPresenceChange(bumpPresence);
    const unsubscribeConnect = realtime.onConnect(() => {
      refreshPresence(trackedIdsRef.current);
    });
    const unsubscribeSessionTerminated = realtime.onSessionTerminated((data) => {
      const currentSessionId = api.getSessionId();
      if (!currentSessionId || data.sessionId === currentSessionId) {
        realtime.disconnect();
        endSession();
      }
    });

    const refreshTracked = () => {
      realtime.connect();
      refreshPresence(trackedIdsRef.current);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshTracked();
      }
    };

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshPresence(trackedIdsRef.current);
      }
    }, PRESENCE_REFRESH_MS);

    window.addEventListener('focus', refreshTracked);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      unsubscribePresence();
      unsubscribeConnect();
      unsubscribeSessionTerminated();
      window.removeEventListener('focus', refreshTracked);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(interval);
    };
  }, [bumpPresence, refreshPresence, endSession]);

  const getPresence = useCallback(
    (userId: string | undefined): AvatarPresence | undefined => {
      if (!userId || userId === user?.id) return undefined;
      return realtime.getPresenceStatus(userId) ?? 'offline';
    },
    [user?.id, presenceVersion],
  );

  const getLastSeen = useCallback(
    (userId: string | undefined): string | undefined => {
      if (!userId || userId === user?.id) return undefined;
      return realtime.getLastSeen(userId);
    },
    [user?.id, presenceVersion],
  );

  const value = useMemo(
    () => ({ getPresence, getLastSeen, refreshPresence }),
    [getPresence, getLastSeen, refreshPresence],
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence() {
  const ctx = useContext(PresenceContext);
  if (!ctx) throw new Error('usePresence must be used within PresenceProvider');
  return ctx;
}
