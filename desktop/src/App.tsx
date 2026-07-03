import { useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import { PresenceProvider } from './context/PresenceContext';
import { LoginPage } from './components/LoginPage';
import { ChatPage } from './components/ChatPage';
import { parseInviteTokenFromLink, stashPendingInviteToken } from './utils/channelInvite';

export function App() {
  const { user, loading } = useAuth();

  useEffect(() => {
    const handleInviteLink = (url: string) => {
      const token = parseInviteTokenFromLink(url);
      if (token) stashPendingInviteToken(token);
    };

    return window.electronAPI?.onInviteLink?.(handleInviteLink);
  }, []);

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
