import { useCallback, useEffect, useState } from 'react';
import { UserAvatar } from '../components/UserAvatar';
import { TableSkeleton } from '../components/TableSkeleton';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { api, AdminUser } from '../services/api';
import { formatDate, formatRelative } from '../utils/format';

interface Props {
  onSelectUser: (userId: string) => void;
}

type StatusFilter = 'all' | 'active' | 'inactive';
type RoleFilter = 'all' | 'admin' | 'user';
type SortBy = 'createdAt' | 'displayName' | 'email' | 'updatedAt';

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'createdAt:desc', label: 'Joined (newest)' },
  { value: 'createdAt:asc', label: 'Joined (oldest)' },
  { value: 'updatedAt:desc', label: 'Updated (newest)' },
  { value: 'updatedAt:asc', label: 'Updated (oldest)' },
  { value: 'displayName:asc', label: 'Name (A–Z)' },
  { value: 'displayName:desc', label: 'Name (Z–A)' },
  { value: 'email:asc', label: 'Email (A–Z)' },
  { value: 'email:desc', label: 'Email (Z–A)' },
];

function parseSort(value: string): { sortBy: SortBy; sortDir: 'asc' | 'desc' } {
  const [sortBy, sortDir] = value.split(':') as [SortBy, 'asc' | 'desc'];
  return { sortBy, sortDir };
}

export function UsersPage({ onSelectUser }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [sort, setSort] = useState('createdAt:desc');
  const { sortBy, sortDir } = parseSort(sort);
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setPage(1);
    setSearch(debouncedQ.trim());
  }, [debouncedQ]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listUsers({
        page,
        limit: pageSize,
        q: search || undefined,
        isActive: statusFilter === 'all' ? undefined : statusFilter === 'active',
        isAdmin: roleFilter === 'all' ? undefined : roleFilter === 'admin',
        sortBy,
        sortDir,
      });
      setUsers(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [page, pageSize, search, statusFilter, roleFilter, sortBy, sortDir]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters =
    search.length > 0 || statusFilter !== 'all' || roleFilter !== 'all' || sort !== 'createdAt:desc';

  const clearFilters = () => {
    setQ('');
    setSearch('');
    setStatusFilter('all');
    setRoleFilter('all');
    setSort('createdAt:desc');
    setPage(1);
  };

  return (
    <div className="page page-compact">
      <header className="page-header page-header-compact">
        <p className="page-meta">{total.toLocaleString()} accounts</p>
      </header>

      <div className="toolbar toolbar-sticky">
        <input
          type="search"
          className="search-input"
          placeholder="Search name, email, username…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <div className="toolbar-filters">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as StatusFilter);
              setPage(1);
            }}
            aria-label="Status filter"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value as RoleFilter);
              setPage(1);
            }}
            aria-label="Role filter"
          >
            <option value="all">All roles</option>
            <option value="admin">Admins</option>
            <option value="user">Users</option>
          </select>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
            aria-label="Sort"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            aria-label="Page size"
          >
            <option value={25}>25 rows</option>
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
          <TableSkeleton rows={8} cols={6} />
        ) : (
          <table className="data-table data-table-compact">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Status</th>
                <th>Role</th>
                <th>Sessions</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    No users match your filters.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} onClick={() => onSelectUser(user.id)} className="clickable-row">
                    <td>
                      <div className="user-cell user-cell-with-avatar">
                        <UserAvatar
                          name={user.displayName}
                          avatarUrl={user.avatarUrl}
                          size="sm"
                        />
                        <div>
                          <strong>{user.displayName}</strong>
                          <span>@{user.username}</span>
                        </div>
                      </div>
                    </td>
                    <td className="cell-truncate" title={user.email}>
                      {user.email}
                    </td>
                    <td>
                      <span className={user.isActive ? 'badge badge-success' : 'badge badge-muted'}>
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      {user.isAdmin ? (
                        <span className="badge badge-accent">Admin</span>
                      ) : (
                        <span className="badge badge-muted">User</span>
                      )}
                    </td>
                    <td className="cell-numeric">{user.activeSessionCount ?? 0}</td>
                    <td className="cell-muted" title={formatDate(user.createdAt)}>
                      {formatRelative(user.createdAt)}
                    </td>
                  </tr>
                ))
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
