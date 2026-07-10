import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, AuditLogEntry } from '../services/api';
import { formatDate } from '../utils/format';
import { CopyButton } from '../components/CopyButton';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_DATE_PRESETS,
  auditDateRange,
  formatAuditAction,
  formatAuditDetails,
  formatAuditMetadata,
} from '../utils/auditLabels';

interface Props {
  initialUserId?: string | null;
  onSelectUser?: (userId: string) => void;
}

export function AuditLogsPage({ initialUserId, onSelectUser }: Props) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [action, setAction] = useState('');
  const [datePreset, setDatePreset] = useState('');
  const [userId, setUserId] = useState(initialUserId ?? '');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialUserId) setUserId(initialUserId);
  }, [initialUserId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const range = auditDateRange(datePreset);
      const res = await api.listAuditLogs({
        page,
        limit: pageSize,
        q: search || undefined,
        category: action ? undefined : category || undefined,
        action: action || undefined,
        userId: userId.trim() || undefined,
        from: range.from,
        to: range.to,
      });
      setLogs(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, category, action, userId, datePreset]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const clearFilters = () => {
    setQ('');
    setSearch('');
    setCategory('');
    setAction('');
    setDatePreset('');
    if (!initialUserId) setUserId('');
    setPage(1);
  };

  return (
    <div className="page">
      <header className="page-header row">
        <div>
          <h1>Audit log</h1>
          <p>{total} events recorded</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void load()}>
          Refresh
        </button>
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
            setAction('');
            setPage(1);
          }}
        >
          {AUDIT_CATEGORIES.map((item) => (
            <option key={item.value || 'all'} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            if (e.target.value) setCategory('');
            setPage(1);
          }}
        >
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          value={datePreset}
          onChange={(e) => {
            setDatePreset(e.target.value);
            setPage(1);
          }}
        >
          {AUDIT_DATE_PRESETS.map((item) => (
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
        <select
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
        >
          <option value={20}>20 / page</option>
          <option value={30}>30 / page</option>
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
        </select>
        <button type="button" className="btn btn-ghost" onClick={clearFilters}>
          Clear filters
        </button>
      </div>

      {error && <div className="page-error">{error}</div>}
      {loading ? (
        <div className="page-loading">Loading audit log...</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table audit-table">
            <thead>
              <tr>
                <th />
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
                  <td colSpan={7} className="empty-cell">
                    No audit events match your filters.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const expanded = expandedId === log.id;
                  return (
                    <Fragment key={log.id}>
                      <tr key={log.id} className={expanded ? 'expanded-row' : undefined}>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm expand-btn"
                            onClick={() => setExpandedId(expanded ? null : log.id)}
                            aria-expanded={expanded}
                          >
                            {expanded ? '−' : '+'}
                          </button>
                        </td>
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
                          <span className="badge badge-muted audit-action">
                            {formatAuditAction(log.action)}
                          </span>
                        </td>
                        <td className="audit-details">{formatAuditDetails(log.metadata)}</td>
                        <td className="mono-cell">
                          {log.resourceType ? (
                            <span title={log.resourceId ?? undefined}>
                              {log.resourceType}
                              {log.resourceId ? ` · ${log.resourceId.slice(0, 8)}…` : ''}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="mono-cell">{log.ipAddress ?? '—'}</td>
                      </tr>
                      {expanded && (
                        <tr className="audit-detail-row">
                          <td colSpan={7}>
                            <div className="audit-expanded">
                              <div className="audit-expanded-grid">
                                <div>
                                  <span className="detail-label">Event ID</span>
                                  <code>{log.id}</code>
                                  <CopyButton value={log.id} label="Copy ID" />
                                </div>
                                {log.userEmail && (
                                  <div>
                                    <span className="detail-label">User email</span>
                                    <span>{log.userEmail}</span>
                                  </div>
                                )}
                                {log.resourceId && (
                                  <div>
                                    <span className="detail-label">Resource ID</span>
                                    <code>{log.resourceId}</code>
                                    <CopyButton value={log.resourceId} label="Copy" />
                                  </div>
                                )}
                                {log.actorEmail && (
                                  <div>
                                    <span className="detail-label">Actor</span>
                                    <span>{log.actorDisplayName ?? log.actorEmail}</span>
                                  </div>
                                )}
                              </div>
                              <div>
                                <span className="detail-label">Metadata</span>
                                <pre className="metadata-pre">{formatAuditMetadata(log.metadata)}</pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
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
          Page {page} of {totalPages} · {total} total
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
