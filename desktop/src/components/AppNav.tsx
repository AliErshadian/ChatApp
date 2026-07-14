import { Icon } from './Icon';
import { Avatar } from './Avatar';
import { useEffect, useRef, useState } from 'react';
import { ConfirmModal } from './ConfirmModal';
import { getLogoutConfirm } from '../utils/deleteChatConfirm';
import {
  faComments,
  faHashtag,
  faPhone,
  faUserGroup,
  faListCheck,
  faNoteSticky,
  faEllipsisVertical,
  faRightFromBracket,
} from '@fortawesome/free-solid-svg-icons';

const APP_LOGO_URL = '/logo.png';

export type AppNavTab = 'chats' | 'channels' | 'calls' | 'contacts' | 'tasks' | 'notes' | 'profile';

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
  onNotes: () => void;
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
  onNotes,
  onProfile,
  onLogout,
}: Props) {
  const isBottom = variant === 'bottom';
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const logoutConfirm = getLogoutConfirm();
  const moreMenuActive = activeTab === 'tasks' || activeTab === 'notes' || activeTab === 'profile';

  useEffect(() => {
    if (!moreMenuOpen) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (moreMenuRef.current?.contains(target)) return;
      setMoreMenuOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [moreMenuOpen]);

  useEffect(() => {
    if (moreMenuActive) return;
    setMoreMenuOpen(false);
  }, [moreMenuActive]);

  const closeMoreMenu = () => setMoreMenuOpen(false);

  const tasksNotesButtons = (
    <>
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

      <button
        type="button"
        className={`nav-rail-btn${activeTab === 'notes' ? ' active' : ''}`}
        onClick={onNotes}
        title="Notes"
        aria-label="Notes"
        aria-current={activeTab === 'notes' ? 'page' : undefined}
      >
        <Icon icon={faNoteSticky} />
        {isBottom && <span className="nav-rail-label">Notes</span>}
      </button>
    </>
  );

  const mobileMoreButton = (
    <div className="nav-more-wrap" ref={moreMenuRef}>
      <button
        type="button"
        className={`nav-rail-btn nav-rail-btn--more${moreMenuActive || moreMenuOpen ? ' active' : ''}`}
        onClick={() => setMoreMenuOpen((open) => !open)}
        title="More"
        aria-label={
          tasksUnreadCount > 0
            ? `More, ${tasksUnreadCount} unread task invitations`
            : 'More'
        }
        aria-expanded={moreMenuOpen}
        aria-haspopup="menu"
      >
        <span className="nav-rail-btn-icon">
          <Icon icon={faEllipsisVertical} />
          <NavTabBadge count={tasksUnreadCount} />
        </span>
        {isBottom && <span className="nav-rail-label">More</span>}
      </button>

      {moreMenuOpen && (
        <div className="nav-more-menu" role="menu" aria-label="More navigation">
          <button
            type="button"
            role="menuitem"
            className={`nav-more-menu-item${activeTab === 'tasks' ? ' active' : ''}`}
            onClick={() => {
              closeMoreMenu();
              onTasks();
            }}
          >
            <Icon icon={faListCheck} />
            <span>Tasks</span>
            {tasksUnreadCount > 0 && (
              <span className="nav-more-menu-badge">
                {tasksUnreadCount > 99 ? '99+' : tasksUnreadCount}
              </span>
            )}
          </button>
          <button
            type="button"
            role="menuitem"
            className={`nav-more-menu-item${activeTab === 'notes' ? ' active' : ''}`}
            onClick={() => {
              closeMoreMenu();
              onNotes();
            }}
          >
            <Icon icon={faNoteSticky} />
            <span>Notes</span>
          </button>
          {displayName && (
            <button
              type="button"
              role="menuitem"
              className={`nav-more-menu-item${activeTab === 'profile' ? ' active' : ''}`}
              onClick={() => {
                closeMoreMenu();
                onProfile();
              }}
            >
              <Avatar name={displayName} avatarUrl={avatarUrl} size="sm" />
              <span>Profile</span>
            </button>
          )}
        </div>
      )}
    </div>
  );

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

          {isBottom ? mobileMoreButton : tasksNotesButtons}
        </div>

        {!isBottom && <div className="nav-rail-spacer" />}

        {!isBottom && (
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
            </button>
          )}

          <button
            type="button"
            className="nav-rail-btn nav-rail-btn--logout"
            onClick={() => setLogoutConfirmOpen(true)}
            title="Logout"
            aria-label="Logout"
          >
            <Icon icon={faRightFromBracket} />
          </button>
        </div>
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
