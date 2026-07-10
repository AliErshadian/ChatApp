import { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';

export type AdminPage = 'dashboard' | 'users' | 'user-detail' | 'audit';

interface Props {
  page: AdminPage;
  onNavigate: (page: AdminPage) => void;
  onSelectUser: (userId: string) => void;
  children: ReactNode;
}

export function AdminLayout({ page, onNavigate, children }: Props) {
  const { admin, logout } = useAuth();

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-logo">◆</span>
          <div>
            <strong>ChatApp</strong>
            <small>Admin</small>
          </div>
        </div>
        <nav className="sidebar-nav">
          <button
            type="button"
            className={page === 'dashboard' ? 'nav-item active' : 'nav-item'}
            onClick={() => onNavigate('dashboard')}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={page === 'users' || page === 'user-detail' ? 'nav-item active' : 'nav-item'}
            onClick={() => onNavigate('users')}
          >
            Users
          </button>
          <button
            type="button"
            className={page === 'audit' ? 'nav-item active' : 'nav-item'}
            onClick={() => onNavigate('audit')}
          >
            Audit log
          </button>
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <strong>{admin?.displayName}</strong>
            <span>{admin?.email}</span>
          </div>
          <button type="button" className="btn btn-ghost btn-block" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
