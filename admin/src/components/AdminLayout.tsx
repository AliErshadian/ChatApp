import { ReactNode } from 'react';
import { UserAvatar } from './UserAvatar';
import { useAuth } from '../context/AuthContext';

export type AdminPage = 'dashboard' | 'users' | 'user-detail' | 'audit' | 'authentication' | 'features';

const PAGE_TITLES: Record<AdminPage, string> = {
  dashboard: 'Dashboard',
  users: 'Users',
  'user-detail': 'User detail',
  audit: 'Audit log',
  authentication: 'Authentication',
  features: 'Features',
};

const NAV_ITEMS: Array<{
  page: AdminPage;
  label: string;
  shortLabel: string;
  icon: string;
  matches: AdminPage[];
}> = [
  { page: 'dashboard', label: 'Dashboard', shortLabel: 'Home', icon: '▣', matches: ['dashboard'] },
  { page: 'users', label: 'Users', shortLabel: 'Users', icon: '◎', matches: ['users', 'user-detail'] },
  {
    page: 'authentication',
    label: 'Authentication',
    shortLabel: 'Auth',
    icon: '⬡',
    matches: ['authentication'],
  },
  {
    page: 'features',
    label: 'Features',
    shortLabel: 'Features',
    icon: '◈',
    matches: ['features'],
  },
  { page: 'audit', label: 'Audit log', shortLabel: 'Audit', icon: '☰', matches: ['audit'] },
];

interface Props {
  page: AdminPage;
  onNavigate: (page: AdminPage) => void;
  onSelectUser: (userId: string) => void;
  children: ReactNode;
}

export function AdminLayout({ page, onNavigate, children }: Props) {
  const { admin, logout } = useAuth();

  const isActive = (matches: AdminPage[]) => matches.includes(page);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar" aria-label="Sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-logo">◆</span>
          <div className="sidebar-brand-text">
            <strong>RELAY</strong>
            <small>Admin</small>
          </div>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.page}
              type="button"
              className={isActive(item.matches) ? 'nav-item active' : 'nav-item'}
              onClick={() => onNavigate(item.page)}
            >
              <span className="nav-icon" aria-hidden>
                {item.icon}
              </span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <UserAvatar name={admin?.displayName ?? 'Admin'} avatarUrl={admin?.avatarUrl} size="sm" />
            <div className="sidebar-user-text">
              <strong>{admin?.displayName}</strong>
              <span>{admin?.email}</span>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-block" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="admin-content">
        <header className="admin-topbar">
          <h1 className="admin-topbar-title">{PAGE_TITLES[page]}</h1>
          <div className="admin-topbar-actions">
            <div className="admin-topbar-user">
              <UserAvatar name={admin?.displayName ?? 'Admin'} avatarUrl={admin?.avatarUrl} size="sm" />
              <span className="admin-topbar-user-name">{admin?.displayName}</span>
            </div>
            <button type="button" className="btn btn-ghost btn-sm admin-topbar-signout" onClick={logout}>
              Sign out
            </button>
          </div>
        </header>
        <main className="admin-main">{children}</main>
      </div>

      <nav className="admin-mobile-nav" aria-label="Mobile navigation">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.page}
            type="button"
            className={isActive(item.matches) ? 'mobile-nav-item active' : 'mobile-nav-item'}
            onClick={() => onNavigate(item.page)}
          >
            <span className="mobile-nav-icon" aria-hidden>
              {item.icon}
            </span>
            <span className="mobile-nav-label">{item.shortLabel}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
