import { useEffect, useState } from 'react';
import { api, AdminStats } from '../services/api';
import { formatNumber } from '../utils/format';

export function DashboardPage() {
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

  return (
    <div className="page">
      <header className="page-header">
        <h1>Dashboard</h1>
        <p>Overview of your ChatApp instance</p>
      </header>

      <section className="stat-grid">
        <article className="stat-card">
          <span className="stat-label">Total users</span>
          <strong className="stat-value">{formatNumber(stats.users.total)}</strong>
          <span className="stat-meta">
            {formatNumber(stats.users.active)} active · {formatNumber(stats.users.inactive)} inactive
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
          <span className="stat-meta">{formatNumber(stats.messages.total)} total</span>
        </article>
      </section>

      <section className="panel">
        <h2>Conversations</h2>
        <div className="inline-stats">
          <div>
            <span>Total</span>
            <strong>{formatNumber(stats.conversations.total)}</strong>
          </div>
          <div>
            <span>Direct</span>
            <strong>{formatNumber(stats.conversations.direct)}</strong>
          </div>
          <div>
            <span>Channels</span>
            <strong>{formatNumber(stats.conversations.channel)}</strong>
          </div>
          <div>
            <span>Groups</span>
            <strong>{formatNumber(stats.conversations.group)}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
