import { useAuth } from './context/AuthContext';
import { PresenceProvider } from './context/PresenceContext';
import { LoginPage } from './components/LoginPage';
import { ChatPage } from './components/ChatPage';

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return user ? (
    <PresenceProvider>
      <ChatPage />
    </PresenceProvider>
  ) : (
    <LoginPage />
  );
}
