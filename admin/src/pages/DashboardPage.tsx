import { useEffect, useState } from 'react';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { api, AdminStats } from '../services/api';
import { formatBytes, formatNumber, formatPercent, formatRelative } from '../utils/format';
import { formatAuditAction, formatAuditDetails } from '../utils/auditLabels';
import { StoragePanel } from '../components/StoragePanel';

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

  if (loading) return <div className="page-loading-inline">Loading dashboard…</div>;
  if (error) return <div className="page-error">{error}</div>;
  if (!stats) return null;

  const conv = stats.conversations;
  const storageTotal = Math.max(
    stats.storage.totalBytes,
    stats.storage.database.totalBytes + stats.storage.files.totalBytes,
  );

  return (
    <div className="page page-compact">
      <section className="stat-grid stat-grid-compact">
        <article className="stat-card stat-card-compact">
          <span className="stat-label">Users</span>
          <strong className="stat-value">{formatNumber(stats.users.total)}</strong>
          <span className="stat-meta">
            {formatNumber(stats.users.active)} active · +{formatNumber(stats.users.newLast7d)} / 7d
          </span>
        </article>
        <article className="stat-card stat-card-compact">
          <span className="stat-label">Messages</span>
          <strong className="stat-value">{formatNumber(stats.messages.last24h)}</strong>
          <span className="stat-meta">
            24h · {formatNumber(stats.messages.last7d)} / 7d · {formatNumber(stats.messages.total)} total
          </span>
        </article>
        <article className="stat-card stat-card-compact">
          <span className="stat-label">Conversations</span>
          <strong className="stat-value">{formatNumber(conv.total)}</strong>
          <span className="stat-meta">
            {formatNumber(conv.direct)} direct · {formatNumber(conv.channel)} channels ·{' '}
            {formatNumber(conv.group)} groups
          </span>
        </article>
        <article className="stat-card stat-card-compact">
          <span className="stat-label">Sessions</span>
          <strong className="stat-value">{formatNumber(stats.sessions.active)}</strong>
          <span className="stat-meta">
            {formatNumber(stats.users.admins)} admins · {formatNumber(stats.audit.last24h)} audit / 24h
          </span>
        </article>
      </section>

      <div className="dashboard-panels dashboard-panels-compact">
        <section className="panel panel-compact">
          <div className="panel-header-row">
            <h2>Conversation mix</h2>
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
            <span><i className="dot dot-direct" /> Direct {formatPercent(conv.direct, conv.total)}</span>
            <span><i className="dot dot-channel" /> Channels {formatPercent(conv.channel, conv.total)}</span>
            <span><i className="dot dot-group" /> Groups {formatPercent(conv.group, conv.total)}</span>
          </div>
        </section>

        <section className="panel panel-compact">
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
            <ul className="activity-feed activity-feed-dense">
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
                    <span className="activity-inline-detail">{formatAuditDetails(item.metadata)}</span>
                  </div>
                  <span className="activity-time">{formatRelative(item.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <CollapsibleSection
        title="Storage"
        defaultOpen={false}
        summary={
          <>
            <strong>{formatBytes(storageTotal)}</strong>
            <span className="muted">
              {' '}
              · DB {formatBytes(stats.storage.database.totalBytes)} · MinIO{' '}
              {formatBytes(stats.storage.files.totalBytes)}
            </span>
          </>
        }
      >
        <StoragePanel storage={stats.storage} embedded />
      </CollapsibleSection>
    </div>
  );
}
