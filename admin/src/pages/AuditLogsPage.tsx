import { useCallback, useEffect, useState } from 'react';
import { api, AuditLogEntry } from '../services/api';
import { formatDate } from '../utils/format';
import {
  AUDIT_CATEGORIES,
  formatAuditAction,
  formatAuditDetails,
} from '../utils/auditLabels';

interface Props {
  initialUserId?: string | null;
  onSelectUser?: (userId: string) => void;
}

export function AuditLogsPage({ initialUserId, onSelectUser }: Props) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [userId, setUserId] = useState(initialUserId ?? '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialUserId) setUserId(initialUserId);
  }, [initialUserId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listAuditLogs({
        page,
        limit: 30,
        q: search || undefined,
        category: category || undefined,
        userId: userId.trim() || undefined,
      });
      setLogs(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [page, search, category, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / 30));

  return (
    <div className="page">
      <header className="page-header">
        <h1>Audit log</h1>
        <p>{total} events recorded</p>
      </header>

      <div className="toolbar toolbar-wrap">
        <form
          className="search-form"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(q.trim());
          }}
        >
          <input
            type="search"
            placeholder="Search user, action, resource id..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit" className="btn btn-secondary">
            Search
          </button>
        </form>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
        >
          {AUDIT_CATEGORIES.map((item) => (
            <option key={item.value || 'all'} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <input
          className="filter-user-id"
          type="text"
          placeholder="Filter by user ID"
          value={userId}
          onChange={(e) => {
            setUserId(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {error && <div className="page-error">{error}</div>}
      {loading ? (
        <div className="page-loading">Loading audit log...</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table audit-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Details</th>
                <th>Resource</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    No audit events yet. Actions will appear here as users interact with the app.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id}>
                    <td className="nowrap">{formatDate(log.createdAt)}</td>
                    <td>
                      {log.userId ? (
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => onSelectUser?.(log.userId!)}
                        >
                          <strong>{log.userDisplayName ?? 'Unknown'}</strong>
                          <span>@{log.userUsername ?? log.userId.slice(0, 8)}</span>
                        </button>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                      {log.actorUserId && log.actorUserId !== log.userId && (
                        <div className="audit-actor">
                          by {log.actorDisplayName ?? log.actorEmail ?? 'admin'}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-muted audit-action">{formatAuditAction(log.action)}</span>
                    </td>
                    <td className="audit-details">{formatAuditDetails(log.metadata)}</td>
                    <td className="mono-cell">
                      {log.resourceType && (
                        <span>
                          {log.resourceType}
                          {log.resourceId ? ` · ${log.resourceId.slice(0, 8)}…` : ''}
                        </span>
                      )}
                    </td>
                    <td className="mono-cell">{log.ipAddress ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="pagination">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </button>
        <span>
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
