import { useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import { PresenceProvider } from './context/PresenceContext';
import { AppFeaturesProvider } from './context/AppFeaturesContext';
import { LoginPage } from './components/LoginPage';
import { ChatPage } from './components/ChatPage';
import { SkeletonAppBoot } from './components/Skeleton';
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
    return <SkeletonAppBoot />;
  }

  return user ? (
    <AppFeaturesProvider>
      <PresenceProvider>
        <ChatPage />
      </PresenceProvider>
    </AppFeaturesProvider>
  ) : (
    <LoginPage />
  );
}
