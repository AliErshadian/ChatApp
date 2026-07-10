import { useCallback, useEffect, useState } from 'react';
import { api, AdminUser } from '../services/api';
import { formatDate } from '../utils/format';

interface Props {
  onSelectUser: (userId: string) => void;
}

export function UsersPage({ onSelectUser }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listUsers({
        page,
        limit: 20,
        q: search || undefined,
        isActive: filter === 'all' ? undefined : filter === 'active',
      });
      setUsers(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [page, search, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="page">
      <header className="page-header">
        <h1>Users</h1>
        <p>{total} accounts</p>
      </header>

      <div className="toolbar">
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
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as 'all' | 'active' | 'inactive');
            setPage(1);
          }}
        >
          <option value="all">All users</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
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
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
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
                  <td>{formatDate(user.createdAt)}</td>
                </tr>
              ))}
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
