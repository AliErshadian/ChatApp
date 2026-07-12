import { Fragment, useCallback, useEffect, useState } from 'react';
import { TableSkeleton } from '../components/TableSkeleton';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { api, AuditLogEntry } from '../services/api';
import { formatDate, formatRelative } from '../utils/format';
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
  const [pageSize, setPageSize] = useState(50);
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [action, setAction] = useState('');
  const [datePreset, setDatePreset] = useState('');
  const [userIdInput, setUserIdInput] = useState(initialUserId ?? '');
  const debouncedUserId = useDebouncedValue(userIdInput, 400);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialUserId) setUserIdInput(initialUserId);
  }, [initialUserId]);

  useEffect(() => {
    setPage(1);
    setSearch(debouncedQ.trim());
  }, [debouncedQ]);

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
        userId: debouncedUserId.trim() || undefined,
        from: range.from,
        to: range.to,
      });
      setLogs(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [page, pageSize, search, category, action, debouncedUserId, datePreset]);

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
    if (!initialUserId) setUserIdInput('');
    setPage(1);
  };

  const hasFilters =
    search.length > 0 ||
    category.length > 0 ||
    action.length > 0 ||
    datePreset.length > 0 ||
    (debouncedUserId.trim().length > 0 && !initialUserId);

  return (
    <div className="page page-compact">
      <header className="page-header page-header-compact row">
        <p className="page-meta">{total.toLocaleString()} events</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
          Refresh
        </button>
      </header>

      <div className="toolbar toolbar-sticky">
        <input
          type="search"
          className="search-input"
          placeholder="Search user, action, resource…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="toolbar-filters">
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setAction('');
              setPage(1);
            }}
            aria-label="Category"
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
            aria-label="Action"
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
            aria-label="Date range"
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
            placeholder="User ID"
            value={userIdInput}
            onChange={(e) => {
              setUserIdInput(e.target.value);
              setPage(1);
            }}
          />
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            aria-label="Page size"
          >
            <option value={30}>30 rows</option>
            <option value={50}>50 rows</option>
            <option value={100}>100 rows</option>
          </select>
          {hasFilters && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
              Clear
            </button>
          )}
        </div>
      </div>

      {error && <div className="page-error">{error}</div>}

      <div className={`table-wrap table-scroll ${loading ? 'is-loading' : ''}`}>
        {initialLoad ? (
          <TableSkeleton rows={10} cols={6} />
        ) : (
          <table className="data-table data-table-compact audit-table">
            <thead>
              <tr>
                <th />
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Details</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    No audit events match your filters.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const expanded = expandedId === log.id;
                  return (
                    <Fragment key={log.id}>
                      <tr className={expanded ? 'expanded-row' : undefined}>
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
                        <td className="nowrap cell-muted" title={formatDate(log.createdAt)}>
                          {formatRelative(log.createdAt)}
                        </td>
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
                        <td className="audit-details cell-truncate">{formatAuditDetails(log.metadata)}</td>
                        <td className="mono-cell">{log.ipAddress ?? '—'}</td>
                      </tr>
                      {expanded && (
                        <tr className="audit-detail-row">
                          <td colSpan={6}>
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
                                {log.resourceType && (
                                  <div>
                                    <span className="detail-label">Resource</span>
                                    <span>
                                      {log.resourceType}
                                      {log.resourceId ? ` · ${log.resourceId}` : ''}
                                    </span>
                                    {log.resourceId && <CopyButton value={log.resourceId} label="Copy" />}
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
        )}
      </div>

      <div className="pagination pagination-sticky">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </button>
        <span>
          {page} / {totalPages} · {total.toLocaleString()} total
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page >= totalPages || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
