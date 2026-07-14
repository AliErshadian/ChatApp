import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Message, MessageStatus } from '../services/api';
import { QUICK_REACTION_EMOJIS } from '../constants/messageReactions';
import { clearTextSelection, usePreventTouchSelection } from '../hooks/usePreventTouchSelection';
import { useGhostClickGuard } from '../hooks/useGhostClickGuard';
import { useMentionGlowInView } from '../hooks/useMentionGlowInView';
import { MessageStatusTicks } from './MessageStatusTicks';
import { LinkifiedMessageText } from './LinkifiedMessageText';
import { MessageReplyQuote } from './MessageReplyQuote';
import { MessageForwardedHeader } from './MessageForwardedHeader';
import { MessageAttachmentContent, isAttachmentMessage } from './MessageAttachmentContent';
import { MessagePoll } from './MessagePoll';
import { isPollMessage, isTextMessage } from '../utils/messageMedia';
import { copyTextToClipboard } from '../utils/clipboard';

interface Props {
  message: Message;
  isOwn: boolean;
  isFirstUnread?: boolean;
  isBeingEdited?: boolean;
  showMentionGlow?: boolean;
  scrollRootRef?: React.RefObject<HTMLElement | null>;
  onMentionGlowConsumed?: () => void;
  allowMessageMenu?: boolean;
  canSendActions?: boolean;
  onStartEdit?: (messageId: string, content: string) => void;
  onReply?: (message: Message) => void;
  onOpenThread?: (message: Message) => void;
  onForward?: (message: Message) => void;
  onConvertToTask?: (message: Message) => void;
  onScrollToMessage?: (messageId: string) => void;
  onDelete: (messageId: string, scope: 'me' | 'everyone') => Promise<void>;
  onReaction: (messageId: string, emoji: string) => Promise<void>;
  onPollUpdated?: (message: Message) => void;
}

export function MessageBubble({
  message,
  isOwn,
  isFirstUnread,
  isBeingEdited = false,
  showMentionGlow = false,
  scrollRootRef,
  onMentionGlowConsumed,
  allowMessageMenu = true,
  canSendActions = true,
  onStartEdit,
  onReply,
  onOpenThread,
  onForward,
  onConvertToTask,
  onScrollToMessage,
  onDelete,
  onReaction,
  onPollUpdated,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [layout, setLayout] = useState<{
    anchor: DOMRect;
    focus: { top: number; left: number; width: number };
    side: 'left' | 'right';
  } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>();
  const longPressTriggered = useRef(false);
  const touchOriginRef = useRef<{ x: number; y: number } | null>(null);
  const openedViaTouchRef = useRef(false);

  usePreventTouchSelection(bubbleRef, true);
  const { arm: armGhostClick, isSuppressed: isGhostClickSuppressed } = useGhostClickGuard();

  const canEdit =
    canSendActions &&
    isOwn &&
    isTextMessage(message) &&
    !message.deletedForEveryone &&
    Boolean(onStartEdit);
  const canReply =
    canSendActions &&
    !message.deletedForEveryone &&
    Boolean(onReply || onOpenThread);
  const canForward = !message.deletedForEveryone && Boolean(onForward);
  const copyText = (() => {
    if (message.deletedForEveryone) return '';
    if (isTextMessage(message)) return message.content?.trim() ? message.content : '';
    return message.caption?.trim() ?? '';
  })();
  const canCopy = copyText.length > 0;
  const canConvertToTask =
    !message.deletedForEveryone &&
    Boolean(onConvertToTask) &&
    (canCopy || isAttachmentMessage(message) || isPollMessage(message));
  const replyCount = message.replyCount ?? 0;
  const showThreadChip = !message.threadRootId && (replyCount > 0 || Boolean(onOpenThread));
  const showMenu = allowMessageMenu;
  const isFocused = menuOpen && layout !== null;
  const mentionGlowActive = useMentionGlowInView(
    bubbleRef,
    scrollRootRef,
    showMentionGlow,
    onMentionGlowConsumed,
  );

  const measureLayout = () => {
    if (!bubbleRef.current) return null;
    const anchor = bubbleRef.current.getBoundingClientRect();
    const messagesEl = bubbleRef.current.closest('.messages');
    const messagesRect = messagesEl?.getBoundingClientRect();
    const pad = 12;
    const top = messagesRect ? messagesRect.top + pad : pad;
    const width = anchor.width;
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const useOppositeSide =
      openedViaTouchRef.current && isMobile && touchOriginRef.current !== null;

    let side: 'left' | 'right' = isOwn ? 'right' : 'left';
    let left = anchor.left;

    if (messagesRect) {
      if (useOppositeSide && touchOriginRef.current) {
        const fingerOnRight = touchOriginRef.current.x >= window.innerWidth / 2;
        side = fingerOnRight ? 'left' : 'right';
        left =
          side === 'left'
            ? messagesRect.left + pad
            : messagesRect.right - width - pad;
      } else {
        side = isOwn ? 'right' : 'left';
        left = isOwn ? messagesRect.right - width - pad : messagesRect.left + pad;
      }

      left = Math.max(
        messagesRect.left + pad,
        Math.min(left, messagesRect.right - width - pad),
      );
    }

    const next = { anchor, focus: { top, left, width }, side };
    setLayout(next);
    return next;
  };

  const openMenu = (options?: { viaTouch?: boolean; origin?: { x: number; y: number } }) => {
    if (!allowMessageMenu) return;
    if (options?.origin) {
      touchOriginRef.current = options.origin;
    }
    openedViaTouchRef.current = Boolean(options?.viaTouch);
    clearTextSelection();
    measureLayout();
    setMenuOpen(true);
  };

  const handleMenuButtonOpen = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    clearLongPress();

    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (!isMobile) {
      openMenu();
      return;
    }

    openMenu({ viaTouch: true, origin: { x: e.clientX, y: e.clientY } });
  };

  useEffect(() => {
    if (!menuOpen) {
      setLayout(null);
      openedViaTouchRef.current = false;
      touchOriginRef.current = null;
      return;
    }

    const onResize = () => {
      measureLayout();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [menuOpen, isOwn]);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = undefined;
    }
  };

  const closeMenu = () => {
    if (isGhostClickSuppressed()) return;
    setMenuOpen(false);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!allowMessageMenu) return;
    e.preventDefault();
    openMenu();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!allowMessageMenu) return;
    const touch = e.touches[0];
    touchOriginRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    longPressTriggered.current = false;
    clearLongPress();
    longPressTimer.current = setTimeout(() => {
      clearTextSelection();
      longPressTriggered.current = true;
      armGhostClick();
      openMenu({ viaTouch: true });
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

  const handleDelete = async (scope: 'me' | 'everyone') => {
    setBusy(true);
    try {
      await onDelete(message.id, scope);
      setMenuOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!canCopy) return;
    try {
      await copyTextToClipboard(copyText);
      setMenuOpen(false);
    } catch {
      // Clipboard may be unavailable; leave menu open so the user can retry.
    }
  };

  const handleReaction = async (emoji: string) => {
    setBusy(true);
    try {
      await onReaction(message.id, emoji);
      setMenuOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const reactionsBar = !message.deletedForEveryone && (message.reactions?.length ?? 0) > 0 && (
    <div className="message-reactions">
      {message.reactions!.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          className={`message-reaction-chip${reaction.reactedByMe ? ' active' : ''}`}
          onClick={
            allowMessageMenu
              ? (e) => {
                  e.stopPropagation();
                  void handleReaction(reaction.emoji);
                }
              : undefined
          }
          disabled={busy || !allowMessageMenu}
          aria-label={`React with ${reaction.emoji}`}
        >
          <span className="message-reaction-emoji">{reaction.emoji}</span>
          <span className="message-reaction-count">{reaction.count}</span>
        </button>
      ))}
    </div>
  );

  const placeholderWidth = layout?.anchor.width;
  const placeholderHeight = layout?.anchor.height;

  const bubbleContent = (
    <div
      ref={bubbleRef}
      id={isFocused ? undefined : `msg-${message.id}`}
      className={`message ${isOwn ? 'own' : 'incoming'} ${message.deletedForEveryone ? 'deleted' : ''} ${menuOpen ? 'menu-open' : ''} ${isBeingEdited ? 'being-edited' : ''} ${mentionGlowActive ? 'mention-glow' : ''}`}
      onContextMenu={isFocused ? undefined : handleContextMenu}
      onTouchStart={isFocused ? undefined : handleTouchStart}
      onTouchEnd={isFocused ? undefined : handleTouchEnd}
      onTouchMove={isFocused ? undefined : handleTouchMove}
    >
      {!isOwn && (
        <div className="message-meta">
          <strong>{message.sender?.displayName ?? 'Unknown'}</strong>
        </div>
      )}

      {message.deletedForEveryone ? (
        <div className="message-content deleted">Message deleted</div>
      ) : (
        <>
          {message.forwardedFrom && (
            <MessageForwardedHeader forwardedFrom={message.forwardedFrom} isOwn={isOwn} />
          )}
          {message.replyTo && (
            <MessageReplyQuote
              replyTo={message.replyTo}
              isOwn={isOwn}
              onScrollToMessage={onScrollToMessage}
            />
          )}
          {isPollMessage(message) ? (
            <MessagePoll
              message={message}
              isOwn={isOwn}
              canInteract={canSendActions}
              onUpdated={(updated) => onPollUpdated?.(updated)}
            />
          ) : isAttachmentMessage(message) ? (
            <MessageAttachmentContent message={message} isOwn={isOwn} />
          ) : (
            <div className="message-content">
              <LinkifiedMessageText text={message.content} mentions={message.mentions} />
            </div>
          )}
        </>
      )}

      {reactionsBar}

      {showThreadChip && !message.deletedForEveryone && replyCount > 0 && (
        <button
          type="button"
          className={`message-thread-chip${(message.unreadReplyCount ?? 0) > 0 ? ' has-unread' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenThread?.(message);
          }}
        >
          <span>
            {replyCount === 1 ? '1 reply' : `${replyCount} replies`}
          </span>
          {(message.unreadReplyCount ?? 0) > 0 && (
            <span
              className="message-thread-unread"
              aria-label={`${message.unreadReplyCount} unread`}
            >
              {(message.unreadReplyCount ?? 0) > 99 ? '99+' : message.unreadReplyCount}
            </span>
          )}
        </button>
      )}

      <div className="message-footer">
        <div className="message-footer-left">
          <time>{new Date(message.createdAt).toLocaleTimeString()}</time>
          {message.editedAt && !message.deletedForEveryone && (
            <span className="message-edited">Edited</span>
          )}
        </div>
        {isOwn && message.status && !message.deletedForEveryone && (
          <MessageStatusTicks status={message.status as MessageStatus} />
        )}
      </div>

      {showMenu && !menuOpen && (
        <div className="message-menu-wrap">
          <button
            type="button"
            className="message-menu-btn"
            onClick={handleMenuButtonOpen}
            onTouchStart={(e) => {
              e.stopPropagation();
              clearLongPress();
            }}
            aria-label="Message options"
            disabled={busy}
          >
            ⋮
          </button>
        </div>
      )}
    </div>
  );

  const focusSide = layout?.side ?? (isOwn ? 'right' : 'left');
  const focusAlignClass = focusSide === 'right' ? 'own' : 'incoming';

  const menuPanel = menuOpen && showMenu && (
    <div className={`message-menu-panel ${focusAlignClass}`}>
      {!message.deletedForEveryone && (
        <div className="message-reactions-picker">
          {QUICK_REACTION_EMOJIS.map((emoji) => {
            const active = message.reactions?.some(
              (reaction) => reaction.emoji === emoji && reaction.reactedByMe,
            );
            return (
              <button
                key={emoji}
                type="button"
                className={`message-reaction-btn${active ? ' active' : ''}`}
                onClick={() => void handleReaction(emoji)}
                disabled={busy}
                aria-label={`React with ${emoji}`}
              >
                {emoji}
              </button>
            );
          })}
        </div>
      )}
      <div className="message-menu">
        {canReply && (
          <button
            type="button"
            onClick={() => {
              if (onOpenThread) {
                onOpenThread(message);
              } else {
                onReply?.(message);
              }
              setMenuOpen(false);
            }}
          >
            {onOpenThread ? 'Reply in thread' : 'Reply'}
          </button>
        )}
        {canCopy && (
          <button type="button" onClick={() => void handleCopy()} disabled={busy}>
            Copy
          </button>
        )}
        {canForward && (
          <button
            type="button"
            onClick={() => {
              onForward?.(message);
              setMenuOpen(false);
            }}
          >
            Forward
          </button>
        )}
        {canConvertToTask && (
          <button
            type="button"
            onClick={() => {
              onConvertToTask?.(message);
              setMenuOpen(false);
            }}
          >
            Convert to Task
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              onStartEdit?.(message.id, message.content);
              setMenuOpen(false);
            }}
          >
            Edit
          </button>
        )}
        <button type="button" onClick={() => handleDelete('me')}>
          Delete for me
        </button>
        {isOwn && !message.deletedForEveryone && (
          <button type="button" className="danger" onClick={() => handleDelete('everyone')}>
            Delete for everyone
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="message-group">
      {isFirstUnread && (
        <div className="unread-divider">
          <span>Unread messages</span>
        </div>
      )}

      <div className={`message-row ${isOwn ? 'own' : 'incoming'}`}>
        {isFocused && placeholderWidth && placeholderHeight && (
          <div
            className="message-placeholder"
            style={{ width: placeholderWidth, height: placeholderHeight }}
            aria-hidden
          />
        )}

        {!isFocused && bubbleContent}
      </div>

      {isFocused &&
        layout &&
        createPortal(
          <>
            <button
              type="button"
              className="message-focus-backdrop"
              aria-label="Close message menu"
              onClick={closeMenu}
              onTouchEnd={(e) => {
                if (isGhostClickSuppressed()) e.preventDefault();
              }}
            />
            <div
              id={`msg-${message.id}`}
              className={`message-focus-stack ${focusAlignClass} message-focused`}
              style={{
                position: 'fixed',
                top: layout.focus.top,
                left: layout.focus.left,
                width: layout.focus.width,
                zIndex: 3001,
              }}
              onContextMenu={handleContextMenu}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
            >
              {bubbleContent}
              {menuPanel}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
