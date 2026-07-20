import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AdminLayout, AdminPage } from './components/AdminLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { UsersPage } from './pages/UsersPage';
import { UserDetailPage } from './pages/UserDetailPage';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { AuthenticationSettingsPage } from './pages/AuthenticationSettingsPage';

function AdminApp() {
  const { admin, loading } = useAuth();
  const [page, setPage] = useState<AdminPage>('dashboard');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [auditUserId, setAuditUserId] = useState<string | null>(null);

  if (loading) {
    return <div className="app-loading">Loading...</div>;
  }

  if (!admin) {
    return <LoginPage />;
  }

  const navigate = (next: AdminPage) => {
    setPage(next);
    if (next !== 'user-detail') setSelectedUserId(null);
    if (next !== 'audit') setAuditUserId(null);
  };

  const selectUser = (userId: string) => {
    setSelectedUserId(userId);
    setPage('user-detail');
  };

  const openUserAudit = (userId: string) => {
    setAuditUserId(userId);
    setPage('audit');
  };

  return (
    <AdminLayout page={page} onNavigate={navigate} onSelectUser={selectUser}>
      {page === 'dashboard' && (
        <DashboardPage onSelectUser={selectUser} onOpenAudit={() => navigate('audit')} />
      )}
      {page === 'users' && <UsersPage onSelectUser={selectUser} />}
      {page === 'user-detail' && selectedUserId && (
        <UserDetailPage
          userId={selectedUserId}
          onBack={() => navigate('users')}
          onViewAudit={openUserAudit}
        />
      )}
      {page === 'authentication' && <AuthenticationSettingsPage />}
      {page === 'audit' && (
        <AuditLogsPage initialUserId={auditUserId} onSelectUser={selectUser} />
      )}
    </AdminLayout>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AdminApp />
    </AuthProvider>
  );
}
