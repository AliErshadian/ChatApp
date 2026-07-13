import { Avatar } from './Avatar';
import { useState } from 'react';
import { ConfirmModal } from './ConfirmModal';
import { getLogoutConfirm } from '../utils/deleteChatConfirm';

const APP_LOGO_URL = '/logo.png';

export type AppNavTab = 'chats' | 'channels' | 'calls' | 'contacts' | 'profile';

interface Props {
  variant: 'rail' | 'bottom';
  activeTab: AppNavTab;
  displayName?: string;
  avatarUrl?: string;
  chatsUnreadCount?: number;
  channelsUnreadCount?: number;
  callsMissedCount?: number;
  onChats: () => void;
  onChannels: () => void;
  onCalls: () => void;
  onContacts: () => void;
  onProfile: () => void;
  onLogout: () => void;
}

function NavTabBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <span className="nav-rail-badge" aria-hidden="true">
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function AppNav({
  variant,
  activeTab,
  displayName,
  avatarUrl,
  chatsUnreadCount = 0,
  channelsUnreadCount = 0,
  callsMissedCount = 0,
  onChats,
  onChannels,
  onCalls,
  onContacts,
  onProfile,
  onLogout,
}: Props) {
  const isBottom = variant === 'bottom';
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const logoutConfirm = getLogoutConfirm();

  return (
    <>
    <nav
      className={`nav-rail${isBottom ? ' nav-rail--bottom' : ''}`}
      aria-label="Main navigation"
    >
      {!isBottom && (
        <div className="nav-rail-brand" title="ChatApp">
          {logoFailed ? (
            'C'
          ) : (
            <img
              src={APP_LOGO_URL}
              alt=""
              className="nav-rail-brand-img"
              onError={() => setLogoFailed(true)}
            />
          )}
        </div>
      )}

      <button
        type="button"
        className={`nav-rail-btn${activeTab === 'chats' ? ' active' : ''}`}
        onClick={onChats}
        title="Chats"
        aria-label={
          chatsUnreadCount > 0 ? `Chats, ${chatsUnreadCount} with unread messages` : 'Chats'
        }
        aria-current={activeTab === 'chats' ? 'page' : undefined}
      >
        <span className="nav-rail-btn-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <NavTabBadge count={chatsUnreadCount} />
        </span>
        {isBottom && <span className="nav-rail-label">Chats</span>}
      </button>

      <button
        type="button"
        className={`nav-rail-btn${activeTab === 'channels' ? ' active' : ''}`}
        onClick={onChannels}
        title="Channels"
        aria-label={
          channelsUnreadCount > 0
            ? `Channels, ${channelsUnreadCount} with unread messages`
            : 'Channels'
        }
        aria-current={activeTab === 'channels' ? 'page' : undefined}
      >
        <span className="nav-rail-btn-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9h16" />
            <path d="M4 15h16" />
            <path d="M10 3 8 21" />
            <path d="M16 3 14 21" />
          </svg>
          <NavTabBadge count={channelsUnreadCount} />
        </span>
        {isBottom && <span className="nav-rail-label">Channels</span>}
      </button>

      <button
        type="button"
        className={`nav-rail-btn${activeTab === 'calls' ? ' active' : ''}`}
        onClick={onCalls}
        title="Calls"
        aria-label={
          callsMissedCount > 0 ? `Calls, ${callsMissedCount} missed` : 'Calls'
        }
        aria-current={activeTab === 'calls' ? 'page' : undefined}
      >
        <span className="nav-rail-btn-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          <NavTabBadge count={callsMissedCount} />
        </span>
        {isBottom && <span className="nav-rail-label">Calls</span>}
      </button>

      <button
        type="button"
        className={`nav-rail-btn${activeTab === 'contacts' ? ' active' : ''}`}
        onClick={onContacts}
        title="Contacts"
        aria-label="Contacts"
        aria-current={activeTab === 'contacts' ? 'page' : undefined}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        {isBottom && <span className="nav-rail-label">Contacts</span>}
      </button>

      {!isBottom && <div className="nav-rail-spacer" />}

      {displayName && (
        <button
          type="button"
          className={`nav-rail-btn nav-rail-btn--avatar${activeTab === 'profile' ? ' active' : ''}`}
          onClick={onProfile}
          title="My profile"
          aria-label="My profile"
          aria-current={activeTab === 'profile' ? 'page' : undefined}
        >
          <Avatar name={displayName} avatarUrl={avatarUrl} size="sm" />
          {isBottom && <span className="nav-rail-label">Profile</span>}
        </button>
      )}

      {!isBottom && (
        <button
          type="button"
          className="nav-rail-btn nav-rail-btn--logout"
          onClick={() => setLogoutConfirmOpen(true)}
          title="Logout"
          aria-label="Logout"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
        </button>
      )}
    </nav>

    <ConfirmModal
      open={logoutConfirmOpen}
      title={logoutConfirm.title}
      message={logoutConfirm.message}
      confirmLabel={logoutConfirm.confirmLabel}
      danger={logoutConfirm.danger}
      onConfirm={() => {
        setLogoutConfirmOpen(false);
        onLogout();
      }}
      onCancel={() => setLogoutConfirmOpen(false)}
    />
    </>
  );
}
