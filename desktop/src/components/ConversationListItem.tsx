import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Conversation } from '../services/api';
import { Avatar } from './Avatar';
import { ConfirmModal } from './ConfirmModal';
import { getDirectPeer } from '../utils/conversation';
import { usePresence } from '../context/PresenceContext';
import { formatConversationPreview } from '../utils/conversationList';
import { getDeleteChatConfirm } from '../utils/deleteChatConfirm';
import { ChannelLeaveModal } from './ChannelLeaveModal';
import { formatRelativeTime } from '../utils/time';
import { clearTextSelection, usePreventTouchSelection } from '../hooks/usePreventTouchSelection';
import { useGhostClickGuard } from '../hooks/useGhostClickGuard';

interface Props {
  conversation: Conversation;
  currentUserId: string;
  isActive: boolean;
  isSelected: boolean;
  showUnread: boolean;
  unreadCount: number;
  deleteBusy?: boolean;
  onClick: () => void;
  onTogglePin?: () => void | Promise<void>;
  onDeleteChat: (scope: 'me' | 'everyone') => void | Promise<void>;
  onLeaveChannel?: (newOwnerId?: string) => void | Promise<void>;
}

export function ConversationListItem({
  conversation,
  currentUserId,
  isActive,
  isSelected,
  showUnread,
  unreadCount,
  deleteBusy = false,
  onClick,
  onTogglePin,
  onDeleteChat,
  onLeaveChannel,
}: Props) {
  const { getPresence } = usePresence();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | null>(null);
  const [pendingDelete, setPendingDelete] = useState<'me' | 'everyone' | null>(null);
  const [pendingLeave, setPendingLeave] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>();
  const longPressTriggered = useRef(false);
  const itemRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  usePreventTouchSelection(buttonRef);
  const { arm: armGhostClick, isSuppressed: isGhostClickSuppressed } = useGhostClickGuard();

  const peer = getDirectPeer(conversation, currentUserId);
  const isChannel = conversation.type === 'channel';
  const isGroup = conversation.type === 'group';
  const isMultiMember = isChannel || isGroup;
  const preview = formatConversationPreview(conversation, currentUserId);
  const time = conversation.lastMessage?.createdAt
    ? formatRelativeTime(conversation.lastMessage.createdAt)
    : null;

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = undefined;
    }
  };

  const measureMenu = () => {
    if (!itemRef.current) return null;
    const rect = itemRef.current.getBoundingClientRect();
    const menuItemCount = isMultiMember ? 2 : 3;
    const menuHeight = menuItemCount * 38 + 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openAbove = spaceBelow < menuHeight && rect.top > menuHeight;
    const top = openAbove ? rect.top - menuHeight - 4 : rect.bottom + 4;

    return {
      position: 'fixed' as const,
      top,
      left: rect.left,
      width: rect.width,
      zIndex: 2501,
    };
  };

  const openMenu = () => {
    clearTextSelection();
    setMenuStyle(measureMenu());
    setMenuOpen(true);
  };

  const closeMenu = () => {
    if (isGhostClickSuppressed()) return;
    setMenuOpen(false);
    setMenuStyle(null);
  };

  useLayoutEffect(() => {
    if (!menuOpen) return;
    setMenuStyle(measureMenu());
  }, [menuOpen]);

  useEffect(() => {
    return () => clearLongPress();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    const onResize = () => setMenuStyle(measureMenu());

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [menuOpen]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu();
  };

  const handleTouchStart = () => {
    longPressTriggered.current = false;
    clearLongPress();
    longPressTimer.current = setTimeout(() => {
      clearTextSelection();
      longPressTriggered.current = true;
      armGhostClick();
      openMenu();
    }, 500);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    clearLongPress();
    if (longPressTriggered.current) {
      e.preventDefault();
      clearTextSelection();
      armGhostClick();
    }
  };

  const handleTouchMove = () => {
    clearLongPress();
  };

  const handleClick = () => {
    if (isGhostClickSuppressed()) return;
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }
    if (menuOpen) return;
    onClick();
  };

  const handleDeleteRequest = (scope: 'me' | 'everyone') => {
    closeMenu();
    setPendingDelete(scope);
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDelete) return;
    setConfirming(true);
    try {
      await onDeleteChat(pendingDelete);
      setPendingDelete(null);
    } finally {
      setConfirming(false);
    }
  };

  const handleLeaveRequest = () => {
    closeMenu();
    setPendingLeave(true);
  };

  const handleLeaveConfirm = async (newOwnerId?: string) => {
    if (!onLeaveChannel) return;
    setConfirming(true);
    try {
      await onLeaveChannel(newOwnerId);
      setPendingLeave(false);
    } finally {
      setConfirming(false);
    }
  };

  const pinLabel = conversation.isPinned
    ? isChannel
      ? 'Unpin channel'
      : isGroup
        ? 'Unpin group'
        : 'Unpin chat'
    : isChannel
      ? 'Pin channel'
      : isGroup
        ? 'Pin group'
        : 'Pin chat';

  const handleTogglePin = async () => {
    if (!onTogglePin) return;
    closeMenu();
    setConfirming(true);
    try {
      await onTogglePin();
    } finally {
      setConfirming(false);
    }
  };

  const deleteConfirm = pendingDelete ? getDeleteChatConfirm(pendingDelete) : null;

  return (
    <div
      ref={itemRef}
      className={['conversation-item-wrap', menuOpen && 'menu-open'].filter(Boolean).join(' ')}
    >
      <button
        ref={buttonRef}
        type="button"
        className={[
          'conversation-item',
          isActive && 'active',
          isSelected && 'selected',
          showUnread && 'has-unread',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
      >
        <div className="conv-avatar-wrap">
          {conversation.type === 'direct' ? (
            <Avatar
              name={peer?.displayName ?? conversation.name}
              avatarUrl={peer?.avatarUrl}
              size="sm"
              presence={peer ? getPresence(peer.userId) : undefined}
            />
          ) : (
            <Avatar name={conversation.name} avatarUrl={conversation.avatarUrl} size="sm" />
          )}
        </div>

        <div className="conv-body">
          <div className="conv-top-row">
            <span className="conv-name">
              {conversation.isPinned && (
                <span className="conv-pin-icon" aria-label="Pinned" title="Pinned">
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M9.5 1.5 8.8 3H6.2L5.5 1.5 4 2l.9 2.1L3 6v1.5l2.5.7V14h5V8.2L13 7.5V6l-2.9-.9L11 3l-1.5-.5z"
                    />
                  </svg>
                </span>
              )}
              {conversation.name}
            </span>
            {time && <span className="conv-time">{time}</span>}
          </div>
          <div className="conv-bottom-row">
            <span className="conv-preview">{preview}</span>
            {showUnread && (
              <span className="unread-badge" aria-label={`${unreadCount} unread messages`}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
        </div>
      </button>

      {menuOpen &&
        createPortal(
          <>
            <button
              type="button"
              className="conversation-menu-backdrop"
              aria-label="Close menu"
              onClick={closeMenu}
              onTouchEnd={(e) => {
                if (isGhostClickSuppressed()) e.preventDefault();
              }}
            />
            {menuStyle && (
              <div className="conversation-menu conversation-menu--fixed" style={menuStyle} role="menu">
                {onTogglePin && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={deleteBusy || confirming}
                    onClick={handleTogglePin}
                  >
                    {pinLabel}
                  </button>
                )}
                {isMultiMember ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    disabled={deleteBusy || confirming}
                    onClick={handleLeaveRequest}
                  >
                    {isGroup ? 'Leave group' : 'Leave channel'}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={deleteBusy || confirming}
                      onClick={() => handleDeleteRequest('me')}
                    >
                      Delete for me
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="danger"
                      disabled={deleteBusy || confirming}
                      onClick={() => handleDeleteRequest('everyone')}
                    >
                      {deleteBusy || confirming ? 'Deleting...' : 'Delete for everyone'}
                    </button>
                  </>
                )}
              </div>
            )}
          </>,
          document.body,
        )}

      {deleteConfirm && (
        <ConfirmModal
          open
          title={deleteConfirm.title}
          message={deleteConfirm.message}
          confirmLabel={deleteConfirm.confirmLabel}
          danger={deleteConfirm.danger}
          busy={deleteBusy || confirming}
          onConfirm={handleDeleteConfirm}
          onCancel={() => {
            if (!deleteBusy && !confirming) setPendingDelete(null);
          }}
        />
      )}

      {pendingLeave && onLeaveChannel && (
        <ChannelLeaveModal
          open
          conversation={conversation}
          currentUserId={currentUserId}
          busy={deleteBusy || confirming}
          onConfirm={handleLeaveConfirm}
          onCancel={() => {
            if (!deleteBusy && !confirming) setPendingLeave(false);
          }}
        />
      )}
    </div>
  );
}
