import { useEffect, useState } from 'react';
import { api, AdminStats } from '../services/api';
import { formatNumber, formatPercent, formatRelative } from '../utils/format';
import { formatAuditAction, formatAuditDetails } from '../utils/auditLabels';

interface Props {
  onSelectUser?: (userId: string) => void;
  onOpenAudit?: () => void;
}

export function DashboardPage({ onSelectUser, onOpenAudit }: Props) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getStats()
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load stats');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="page-loading">Loading dashboard...</div>;
  if (error) return <div className="page-error">{error}</div>;
  if (!stats) return null;

  const conv = stats.conversations;

  return (
    <div className="page">
      <header className="page-header">
        <h1>Dashboard</h1>
        <p>Overview of your ChatApp instance</p>
      </header>

      <section className="stat-grid stat-grid-wide">
        <article className="stat-card">
          <span className="stat-label">Total users</span>
          <strong className="stat-value">{formatNumber(stats.users.total)}</strong>
          <span className="stat-meta">
            {formatNumber(stats.users.active)} active · {formatNumber(stats.users.inactive)} inactive
          </span>
        </article>
        <article className="stat-card">
          <span className="stat-label">New users (7d)</span>
          <strong className="stat-value">{formatNumber(stats.users.newLast7d)}</strong>
          <span className="stat-meta">
            {formatPercent(stats.users.newLast7d, stats.users.total)} of total
          </span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Administrators</span>
          <strong className="stat-value">{formatNumber(stats.users.admins)}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Active sessions</span>
          <strong className="stat-value">{formatNumber(stats.sessions.active)}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Messages (24h)</span>
          <strong className="stat-value">{formatNumber(stats.messages.last24h)}</strong>
          <span className="stat-meta">{formatNumber(stats.messages.last7d)} in 7 days</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Audit events (24h)</span>
          <strong className="stat-value">{formatNumber(stats.audit.last24h)}</strong>
          {onOpenAudit && (
            <button type="button" className="stat-link" onClick={onOpenAudit}>
              View audit log →
            </button>
          )}
        </article>
      </section>

      <div className="dashboard-panels">
        <section className="panel">
          <h2>Conversations</h2>
          <div className="inline-stats">
            <div>
              <span>Total</span>
              <strong>{formatNumber(conv.total)}</strong>
            </div>
            <div>
              <span>Direct</span>
              <strong>{formatNumber(conv.direct)}</strong>
              <small>{formatPercent(conv.direct, conv.total)}</small>
            </div>
            <div>
              <span>Channels</span>
              <strong>{formatNumber(conv.channel)}</strong>
              <small>{formatPercent(conv.channel, conv.total)}</small>
            </div>
            <div>
              <span>Groups</span>
              <strong>{formatNumber(conv.group)}</strong>
              <small>{formatPercent(conv.group, conv.total)}</small>
            </div>
          </div>
          <div className="bar-chart">
            <div
              className="bar-segment bar-direct"
              style={{ width: `${conv.total ? (conv.direct / conv.total) * 100 : 0}%` }}
              title={`Direct: ${conv.direct}`}
            />
            <div
              className="bar-segment bar-channel"
              style={{ width: `${conv.total ? (conv.channel / conv.total) * 100 : 0}%` }}
              title={`Channels: ${conv.channel}`}
            />
            <div
              className="bar-segment bar-group"
              style={{ width: `${conv.total ? (conv.group / conv.total) * 100 : 0}%` }}
              title={`Groups: ${conv.group}`}
            />
          </div>
          <div className="bar-legend">
            <span><i className="dot dot-direct" /> Direct</span>
            <span><i className="dot dot-channel" /> Channels</span>
            <span><i className="dot dot-group" /> Groups</span>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header-row">
            <h2>Recent activity</h2>
            {onOpenAudit && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenAudit}>
                View all
              </button>
            )}
          </div>
          {stats.recentActivity.length === 0 ? (
            <p className="muted">No activity recorded yet.</p>
          ) : (
            <ul className="activity-feed">
              {stats.recentActivity.map((item) => (
                <li key={item.id}>
                  <div className="activity-main">
                    <span className="badge badge-muted">{formatAuditAction(item.action)}</span>
                    {item.userId ? (
                      <button
                        type="button"
                        className="link-button inline"
                        onClick={() => onSelectUser?.(item.userId!)}
                      >
                        {item.userDisplayName ?? item.userEmail ?? 'User'}
                      </button>
                    ) : (
                      <span className="text-muted">Unknown user</span>
                    )}
                  </div>
                  <div className="activity-meta">
                    <span>{formatAuditDetails(item.metadata)}</span>
                    <span>{formatRelative(item.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Message volume</h2>
        <div className="inline-stats">
          <div>
            <span>All time</span>
            <strong>{formatNumber(stats.messages.total)}</strong>
          </div>
          <div>
            <span>Last 24 hours</span>
            <strong>{formatNumber(stats.messages.last24h)}</strong>
          </div>
          <div>
            <span>Last 7 days</span>
            <strong>{formatNumber(stats.messages.last7d)}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
