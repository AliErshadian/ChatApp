import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ActiveSession } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { sessionIcon, sessionStatusLabel } from '../utils/sessionDisplay';
import { Icon } from './Icon';

export function SessionsPanel() {
  const { logout } = useAuth();
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [terminatingOthers, setTerminatingOthers] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => api.getSessionId());

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError('');
    setCurrentSessionId(api.getSessionId());
    try {
      const next = await api.listSessions();
      setSessions(next);
      setCurrentSessionId(api.getSessionId());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load devices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const otherSessions = useMemo(
    () => sessions.filter((session) => session.sessionId !== currentSessionId),
    [sessions, currentSessionId],
  );

  const handleTerminate = async (sessionId: string) => {
    setBusySessionId(sessionId);
    setError('');
    try {
      await api.revokeSession(sessionId);
      if (sessionId === currentSessionId) {
        logout();
        return;
      }
      setSessions((prev) => prev.filter((session) => session.sessionId !== sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to terminate session');
    } finally {
      setBusySessionId(null);
    }
  };

  const handleTerminateOthers = async () => {
    const sessionId = api.getSessionId();
    if (!sessionId || otherSessions.length === 0) return;

    setTerminatingOthers(true);
    setError('');
    try {
      await api.revokeOtherSessions(sessionId);
      setSessions((prev) => prev.filter((session) => session.sessionId === sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to terminate other sessions');
    } finally {
      setTerminatingOthers(false);
    }
  };

  if (loading) {
    return <div className="profile-sessions-loading">Loading devices...</div>;
  }

  if (sessions.length === 0) {
    return <div className="profile-sessions-empty">No active devices</div>;
  }

  return (
    <>
      <p className="profile-sessions-hint">
        Devices where you are signed in. Terminate any session you do not recognize.
      </p>
      <div className="profile-sessions">
        {sessions.map((session) => {
          const isCurrent = session.sessionId === currentSessionId;
          return (
            <div
              key={session.sessionId}
              className={`profile-session-row${isCurrent ? ' profile-session-row-current' : ''}`}
            >
              <div className="profile-session-icon" aria-hidden>
                <Icon icon={sessionIcon(session)} />
              </div>
              <div className="profile-session-info">
                <div className="profile-session-title">
                  {session.deviceLabel}
                  {isCurrent && <span className="profile-session-current">This device</span>}
                </div>
                <div className="profile-session-meta">
                  {sessionStatusLabel(session, isCurrent)}
                  {session.ipAddress && (
                    <span className="profile-session-ip"> · {session.ipAddress}</span>
                  )}
                </div>
              </div>
              {!isCurrent && (
                <button
                  type="button"
                  className="profile-session-logout-btn"
                  onClick={() => handleTerminate(session.sessionId)}
                  disabled={busySessionId === session.sessionId || terminatingOthers}
                >
                  {busySessionId === session.sessionId ? 'Terminating...' : 'Terminate'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {otherSessions.length > 0 && (
        <button
          type="button"
          className="profile-sessions-terminate-all"
          onClick={handleTerminateOthers}
          disabled={terminatingOthers || busySessionId !== null}
        >
          {terminatingOthers ? 'Terminating...' : 'Terminate all other sessions'}
        </button>
      )}
      {error && <p className="profile-error-inline">{error}</p>}
    </>
  );
}
