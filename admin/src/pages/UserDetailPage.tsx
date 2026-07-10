import { useCallback, useEffect, useState } from 'react';
import { api, AdminSession, AdminUser } from '../services/api';
import { formatDate } from '../utils/format';

interface Props {
  userId: string;
  onBack: () => void;
  onViewAudit?: (userId: string) => void;
}

export function UserDetailPage({ userId, onBack, onViewAudit }: Props) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [userData, sessionData] = await Promise.all([
        api.getUser(userId),
        api.listUserSessions(userId),
      ]);
      setUser(userData);
      setSessions(sessionData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateUser = async (patch: { isActive?: boolean; isAdmin?: boolean }) => {
    if (!user) return;
    setBusy(true);
    setError('');
    try {
      const updated = await api.updateUser(user.id, patch);
      setUser(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const revokeSession = async (sessionId: string) => {
    setBusy(true);
    setError('');
    try {
      await api.revokeSession(userId, sessionId);
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke session');
    } finally {
      setBusy(false);
    }
  };

  const revokeAll = async () => {
    if (!window.confirm('Terminate all sessions for this user?')) return;
    setBusy(true);
    setError('');
    try {
      await api.revokeAllSessions(userId);
      setSessions([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke sessions');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="page-loading">Loading user...</div>;
  if (!user) return <div className="page-error">{error || 'User not found'}</div>;

  return (
    <div className="page">
      <header className="page-header row">
        <div>
          <button type="button" className="btn btn-ghost back-btn" onClick={onBack}>
            ← Users
          </button>
          <h1>{user.displayName}</h1>
          <p>
            @{user.username} · {user.email}
          </p>
        </div>
      </header>

      {error && <div className="page-error">{error}</div>}

      <section className="panel">
        <h2>Account</h2>
        <dl className="detail-grid">
          <div>
            <dt>Status</dt>
            <dd>
              <span className={user.isActive ? 'badge badge-success' : 'badge badge-muted'}>
                {user.isActive ? 'Active' : 'Inactive'}
              </span>
            </dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{user.isAdmin ? 'Administrator' : 'User'}</dd>
          </div>
          <div>
            <dt>Joined</dt>
            <dd>{formatDate(user.createdAt)}</dd>
          </div>
          <div>
            <dt>Active sessions</dt>
            <dd>{user.activeSessionCount ?? sessions.length}</dd>
          </div>
        </dl>
        <div className="action-row">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => updateUser({ isActive: !user.isActive })}
          >
            {user.isActive ? 'Deactivate user' : 'Activate user'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => updateUser({ isAdmin: !user.isAdmin })}
          >
            {user.isAdmin ? 'Remove admin' : 'Make admin'}
          </button>
          {onViewAudit && (
            <button type="button" className="btn btn-ghost" onClick={() => onViewAudit(userId)}>
              View audit log
            </button>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header-row">
          <h2>Devices & sessions</h2>
          {sessions.length > 0 && (
            <button type="button" className="btn btn-danger" disabled={busy} onClick={revokeAll}>
              Terminate all
            </button>
          )}
        </div>
        {sessions.length === 0 ? (
          <p className="muted">No active sessions</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>IP</th>
                  <th>Last active</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.sessionId}>
                    <td>
                      <strong>{session.deviceLabel}</strong>
                      <div className="muted">{session.appName}</div>
                    </td>
                    <td>{session.ipAddress ?? '—'}</td>
                    <td>{formatDate(session.lastActiveAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={busy}
                        onClick={() => revokeSession(session.sessionId)}
                      >
                        Terminate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
