import { useCallback, useEffect, useState } from 'react';
import { api, AdminUser } from '../services/api';
import { formatDate, formatRelative } from '../utils/format';

interface Props {
  onSelectUser: (userId: string) => void;
}

type StatusFilter = 'all' | 'active' | 'inactive';
type RoleFilter = 'all' | 'admin' | 'user';
type SortBy = 'createdAt' | 'displayName' | 'email' | 'updatedAt';

export function UsersPage({ onSelectUser }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listUsers({
        page,
        limit: pageSize,
        q: search || undefined,
        isActive:
          statusFilter === 'all' ? undefined : statusFilter === 'active',
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
    }
  }, [page, pageSize, search, statusFilter, roleFilter, sortBy, sortDir]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="page">
      <header className="page-header">
        <h1>Users</h1>
        <p>{total} accounts</p>
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
            placeholder="Search email, username, name..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit" className="btn btn-secondary">
            Search
          </button>
        </form>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as StatusFilter);
            setPage(1);
          }}
        >
          <option value="all">All statuses</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
        <select
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value as RoleFilter);
            setPage(1);
          }}
        >
          <option value="all">All roles</option>
          <option value="admin">Admins only</option>
          <option value="user">Non-admins</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => {
            setSortBy(e.target.value as SortBy);
            setPage(1);
          }}
        >
          <option value="createdAt">Sort: joined</option>
          <option value="updatedAt">Sort: updated</option>
          <option value="displayName">Sort: name</option>
          <option value="email">Sort: email</option>
        </select>
        <select
          value={sortDir}
          onChange={(e) => {
            setSortDir(e.target.value as 'asc' | 'desc');
            setPage(1);
          }}
        >
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
        <select
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
        >
          <option value={10}>10 / page</option>
          <option value={20}>20 / page</option>
          <option value={50}>50 / page</option>
        </select>
      </div>

      {error && <div className="page-error">{error}</div>}
      {loading ? (
        <div className="page-loading">Loading users...</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Status</th>
                <th>Role</th>
                <th>Sessions</th>
                <th>Joined</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    No users match your filters.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} onClick={() => onSelectUser(user.id)} className="clickable-row">
                    <td>
                      <div className="user-cell">
                        <strong>{user.displayName}</strong>
                        <span>@{user.username}</span>
                      </div>
                    </td>
                    <td>{user.email}</td>
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
                    <td>{user.activeSessionCount ?? 0}</td>
                    <td title={formatDate(user.createdAt)}>{formatRelative(user.createdAt)}</td>
                    <td title={formatDate(user.updatedAt)}>{formatRelative(user.updatedAt)}</td>
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
