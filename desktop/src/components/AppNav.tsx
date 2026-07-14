import { Icon } from './Icon';
import { Avatar } from './Avatar';
import { useState } from 'react';
import { ConfirmModal } from './ConfirmModal';
import { getLogoutConfirm } from '../utils/deleteChatConfirm';
import {
  faComments,
  faHashtag,
  faPhone,
  faUserGroup,
  faListCheck,
  faRightFromBracket,
} from '@fortawesome/free-solid-svg-icons';

const APP_LOGO_URL = '/logo.png';

export type AppNavTab = 'chats' | 'channels' | 'calls' | 'contacts' | 'tasks' | 'profile';

interface Props {
  variant: 'rail' | 'bottom';
  activeTab: AppNavTab;
  displayName?: string;
  avatarUrl?: string;
  chatsUnreadCount?: number;
  channelsUnreadCount?: number;
  callsMissedCount?: number;
  tasksUnreadCount?: number;
  onChats: () => void;
  onChannels: () => void;
  onCalls: () => void;
  onContacts: () => void;
  onTasks: () => void;
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
  tasksUnreadCount = 0,
  onChats,
  onChannels,
  onCalls,
  onContacts,
  onTasks,
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

        <div className="nav-rail-primary">
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
              <Icon icon={faComments} />
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
              <Icon icon={faHashtag} />
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
              <Icon icon={faPhone} />
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
            <Icon icon={faUserGroup} />
            {isBottom && <span className="nav-rail-label">Contacts</span>}
          </button>

          <button
            type="button"
            className={`nav-rail-btn${activeTab === 'tasks' ? ' active' : ''}`}
            onClick={onTasks}
            title="Tasks"
            aria-label={
              tasksUnreadCount > 0
                ? `Tasks, ${tasksUnreadCount} unread invitations`
                : 'Tasks'
            }
            aria-current={activeTab === 'tasks' ? 'page' : undefined}
          >
            <span className="nav-rail-btn-icon">
              <Icon icon={faListCheck} />
              <NavTabBadge count={tasksUnreadCount} />
            </span>
            {isBottom && <span className="nav-rail-label">Tasks</span>}
          </button>
        </div>

        {!isBottom && <div className="nav-rail-spacer" />}

        <div className="nav-rail-account">
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
              <Icon icon={faRightFromBracket} />
            </button>
          )}
        </div>
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
