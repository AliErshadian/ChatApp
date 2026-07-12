import { useCallback, useEffect, useState } from 'react';
import { api, AdminSession, AdminUser } from '../services/api';
import { CopyButton } from '../components/CopyButton';
import { UserAvatar } from '../components/UserAvatar';
import { formatDate, formatRelative } from '../utils/format';
import { formatAuditAction, formatAuditDetails } from '../utils/auditLabels';

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
      setUser((prev) => (prev ? { ...prev, ...updated } : updated));
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
      setUser((prev) =>
        prev
          ? { ...prev, activeSessionCount: Math.max(0, (prev.activeSessionCount ?? 1) - 1) }
          : prev,
      );
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
      setUser((prev) => (prev ? { ...prev, activeSessionCount: 0 } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke sessions');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="page-loading-inline">Loading user…</div>;
  if (!user) return <div className="page-error">{error || 'User not found'}</div>;

  return (
    <div className="page page-compact">
      <header className="page-header page-header-compact user-detail-header">
        <button type="button" className="btn btn-ghost back-btn" onClick={onBack}>
          ← Back to users
        </button>
        <div className="user-detail-identity">
          <UserAvatar name={user.displayName} avatarUrl={user.avatarUrl} />
          <div className="user-detail-meta">
            <h2 className="user-detail-name">{user.displayName}</h2>
            <p className="user-detail-subtitle">
              @{user.username} · {user.email}
            </p>
            <div className="stat-chips">
              <span className="stat-chip">
                Status
                <strong>{user.isActive ? 'Active' : 'Inactive'}</strong>
              </span>
              <span className="stat-chip">
                Role
                <strong>{user.isAdmin ? 'Admin' : 'User'}</strong>
              </span>
              <span className="stat-chip">
                Sessions
                <strong>{user.activeSessionCount ?? sessions.length}</strong>
              </span>
              <span className="stat-chip">
                Messages
                <strong>{user.messageCount ?? 0}</strong>
              </span>
              <span className="stat-chip">
                Last seen
                <strong>{user.lastSeenAt ? formatRelative(user.lastSeenAt) : '—'}</strong>
              </span>
            </div>
          </div>
          <div className="user-detail-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={() => updateUser({ isActive: !user.isActive })}
            >
              {user.isActive ? 'Deactivate' : 'Activate'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={() => updateUser({ isAdmin: !user.isAdmin })}
            >
              {user.isAdmin ? 'Remove admin' : 'Make admin'}
            </button>
            {onViewAudit && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onViewAudit(userId)}>
                Audit log
              </button>
            )}
          </div>
        </div>
      </header>

      {error && <div className="page-error">{error}</div>}

      <div className="detail-layout">
        <section className="panel panel-compact">
          <h2>Account</h2>
          <dl className="detail-grid detail-grid-compact">
            <div>
              <dt>User ID</dt>
              <dd className="id-row">
                <code>{user.id}</code>
                <CopyButton value={user.id} />
              </dd>
            </div>
            <div>
              <dt>Joined</dt>
              <dd>{formatDate(user.createdAt)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatDate(user.updatedAt)}</dd>
            </div>
            <div>
              <dt>Conversations</dt>
              <dd>{user.conversationCount ?? 0}</dd>
            </div>
          </dl>
        </section>

        <section className="panel panel-compact">
          <div className="panel-header-row">
            <h2>Sessions ({sessions.length})</h2>
            {sessions.length > 0 && (
              <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={revokeAll}>
                Terminate all
              </button>
            )}
          </div>
          {sessions.length === 0 ? (
            <p className="muted">No active sessions</p>
          ) : (
            <div className="table-wrap table-scroll table-scroll-short">
              <table className="data-table data-table-compact">
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
                        <div className="muted cell-sub">
                          {session.appName}
                          {session.platform ? ` · ${session.platform}` : ''}
                        </div>
                      </td>
                      <td className="mono-cell">{session.ipAddress ?? '—'}</td>
                      <td className="cell-muted" title={formatDate(session.lastActiveAt)}>
                        {formatRelative(session.lastActiveAt)}
                      </td>
                      <td className="cell-actions">
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          disabled={busy}
                          onClick={() => revokeSession(session.sessionId)}
                        >
                          End
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

      {user.recentActivity && user.recentActivity.length > 0 && (
        <section className="panel panel-compact">
          <div className="panel-header-row">
            <h2>Recent activity</h2>
            {onViewAudit && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onViewAudit(userId)}>
                View all
              </button>
            )}
          </div>
          <ul className="activity-feed activity-feed-dense compact">
            {user.recentActivity.map((item) => (
              <li key={item.id}>
                <div className="activity-main">
                  <span className="badge badge-muted">{formatAuditAction(item.action)}</span>
                  <span className="activity-inline-detail">{formatAuditDetails(item.metadata)}</span>
                </div>
                <span className="activity-time">{formatRelative(item.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
