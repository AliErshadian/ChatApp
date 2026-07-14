import { useCallback, useEffect, useRef, useState } from 'react';
import { api, Message } from '../services/api';
import { realtime } from '../services/realtime';
import { MessageBubble } from './MessageBubble';
import { MessageReplyQuote } from './MessageReplyQuote';
import { Icon } from './Icon';
import {
  faArrowLeft,
  faFile,
  faMagnifyingGlass,
  faPaperclip,
  faComments,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { createClientMessageId } from '../utils/uuid';
import {
  ATTACHMENT_ACCEPT,
  formatFileSize,
  getAttachmentMediaLabel,
  getMessagePreviewText,
  isTextMessage,
} from '../utils/messageMedia';
import { mergeOutgoingServerMessage, mergeMessageStatus } from '../utils/messageStatus';
import { isAttachmentMessage } from './MessageAttachmentContent';
import { scrollContainerToMessage, scrollContainerToBottom } from '../utils/messageScroll';

type ThreadTab = 'replies' | 'search' | 'files';

interface ThreadSearchHit {
  id: string;
  snippet: string;
  sender?: { displayName: string };
  createdAt: string;
  isRoot: boolean;
}

interface Props {
  conversationId: string;
  rootMessageId: string;
  currentUserId: string;
  canSend: boolean;
  /** Unread reply count from the main chat chip when opening the thread. */
  initialUnreadCount?: number;
  onClose: () => void;
  onRootMetaChange: (
    rootMessageId: string,
    meta: { replyCount: number; latestReplyAt?: string; unreadReplyCount?: number },
  ) => void;
  onDelete: (messageId: string, scope: 'me' | 'everyone') => Promise<void>;
  onReaction: (messageId: string, emoji: string) => Promise<void>;
  onForward?: (message: Message) => void;
  onStartEdit?: (messageId: string, content: string) => void;
}

function formatReplyLabel(count: number) {
  return count === 1 ? '1 reply' : `${count} replies`;
}

export function ThreadPanel({
  conversationId,
  rootMessageId,
  currentUserId,
  canSend,
  initialUnreadCount = 0,
  onClose,
  onRootMetaChange,
  onDelete,
  onReaction,
  onForward,
  onStartEdit,
}: Props) {
  const [tab, setTab] = useState<ThreadTab>('replies');
  const [root, setRoot] = useState<Message | null>(null);
  const [replies, setReplies] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [sendError, setSendError] = useState('');
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<ThreadSearchHit[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [firstUnreadMessageId, setFirstUnreadMessageId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadGenerationRef = useRef(0);
  const loadingRef = useRef(true);
  const pendingLiveRef = useRef<Message[]>([]);
  const pendingScrollUnreadRef = useRef<string | null>(null);
  const didInitialScrollRef = useRef(false);
  const rootMessageIdRef = useRef(rootMessageId);
  const conversationIdRef = useRef(conversationId);
  const tabRef = useRef(tab);
  rootMessageIdRef.current = rootMessageId;
  conversationIdRef.current = conversationId;
  tabRef.current = tab;

  const syncRootMeta = useCallback(
    (meta: { replyCount: number; latestReplyAt?: string; unreadReplyCount?: number }) => {
      setRoot((prev) => (prev ? { ...prev, ...meta } : prev));
      onRootMetaChange(rootMessageId, meta);
    },
    [onRootMetaChange, rootMessageId],
  );

  const syncRootMetaRef = useRef(syncRootMeta);
  syncRootMetaRef.current = syncRootMeta;

  const mergeReplyList = useCallback((existing: Message[], incoming: Message[]): Message[] => {
    const next = [...existing];
    for (const msg of incoming) {
      const byClient = msg.clientMessageId
        ? next.findIndex((m) => m.clientMessageId === msg.clientMessageId)
        : -1;
      const byId = next.findIndex((m) => m.id === msg.id);
      const idx = byClient >= 0 ? byClient : byId;
      if (idx >= 0) {
        next[idx] = mergeOutgoingServerMessage(next[idx], msg, next[idx].status);
      } else {
        next.push(msg);
      }
    }
    return next.sort((a, b) => {
      const sa = Number(a.sequence) || 0;
      const sb = Number(b.sequence) || 0;
      if (sa !== sb && sa > 0 && sb > 0) return sa - sb;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }, []);

  const upsertReply = useCallback(
    (msg: Message) => {
      const rootId = rootMessageIdRef.current;
      if (msg.threadRootId !== rootId && msg.id !== rootId) return;

      if (msg.id === rootId || (!msg.threadRootId && msg.id === rootId)) {
        setRoot((prev) => (prev ? { ...prev, ...msg } : msg));
        return;
      }

      if (loadingRef.current) {
        pendingLiveRef.current = mergeReplyList(pendingLiveRef.current, [msg]);
        return;
      }

      setReplies((prev) => mergeReplyList(prev, [msg]));

      if (msg.thread) {
        syncRootMetaRef.current({
          replyCount: msg.thread.replyCount,
          latestReplyAt: msg.thread.latestReplyAt,
        });
      }
    },
    [mergeReplyList],
  );

  const upsertReplyRef = useRef(upsertReply);
  upsertReplyRef.current = upsertReply;

  useEffect(() => {
    const generation = ++loadGenerationRef.current;
    let cancelled = false;
    loadingRef.current = true;
    pendingLiveRef.current = [];
    setLoading(true);
    setError('');
    setRoot(null);
    setReplies([]);
    setFirstUnreadMessageId(null);
    pendingScrollUnreadRef.current = null;
    didInitialScrollRef.current = false;

    api
      .getThread(conversationId, rootMessageId)
      .then((data) => {
        if (cancelled || generation !== loadGenerationRef.current) return;

        const live = pendingLiveRef.current.filter(
          (m) => m.threadRootId === rootMessageId || m.id === rootMessageId,
        );
        const liveReplies = live.filter((m) => m.id !== rootMessageId);
        const liveRoot = live.find((m) => m.id === rootMessageId);

        const mergedReplies = mergeReplyList(data.replies, liveReplies);
        let mergedRoot = liveRoot ? { ...data.root, ...liveRoot } : data.root;

        const liveMeta = [...liveReplies]
          .reverse()
          .find((m) => m.thread)?.thread;
        const replyCount = Math.max(
          mergedRoot.replyCount ?? 0,
          liveMeta?.replyCount ?? 0,
          mergedReplies.filter((m) => !m.deletedForEveryone).length,
        );
        mergedRoot = {
          ...mergedRoot,
          replyCount,
          latestReplyAt:
            liveMeta?.latestReplyAt ??
            mergedRoot.latestReplyAt ??
            mergedReplies[mergedReplies.length - 1]?.createdAt,
        };

        loadingRef.current = false;
        pendingLiveRef.current = [];

        const fromOthers = mergedReplies.filter(
          (m) => m.senderId !== currentUserId && !m.deletedForEveryone,
        );
        let firstUnreadId = data.firstUnreadMessageId;
        if (initialUnreadCount > 0 && fromOthers.length > 0) {
          const idx = Math.max(0, fromOthers.length - initialUnreadCount);
          firstUnreadId = fromOthers[idx]?.id ?? firstUnreadId;
        }

        setRoot(mergedRoot);
        setReplies(mergedReplies);
        setFirstUnreadMessageId(firstUnreadId);
        pendingScrollUnreadRef.current = firstUnreadId;
        onRootMetaChange(rootMessageId, {
          replyCount: mergedRoot.replyCount ?? 0,
          latestReplyAt: mergedRoot.latestReplyAt,
          unreadReplyCount: 0,
        });
      })
      .catch((err) => {
        if (!cancelled && generation === loadGenerationRef.current) {
          loadingRef.current = false;
          setError(err instanceof Error ? err.message : 'Failed to load thread');
        }
      })
      .finally(() => {
        if (!cancelled && generation === loadGenerationRef.current) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, rootMessageId, currentUserId, initialUnreadCount, mergeReplyList, onRootMetaChange]);

  useEffect(() => {
    if (loading || !root || tab !== 'replies' || didInitialScrollRef.current) return;

    const targetId = pendingScrollUnreadRef.current;
    if (targetId) {
      didInitialScrollRef.current = true;
      pendingScrollUnreadRef.current = null;
      // Align first unread to the top of the thread scroller (not center/last).
      scrollContainerToMessage(scrollRef.current, targetId, {
        behavior: 'smooth',
        alignToUnreadDivider: true,
      });
      return;
    }

    didInitialScrollRef.current = true;
    scrollContainerToBottom(scrollRef.current, { behavior: 'auto' });
  }, [loading, root, tab, replies.length]);

  useEffect(() => {
    const unsubMsg = realtime.onMessage((msg) => {
      if (msg.conversationId !== conversationIdRef.current) return;
      const rootId = rootMessageIdRef.current;
      if (msg.id === rootId || msg.threadRootId === rootId) {
        upsertReplyRef.current(msg);
        if (tabRef.current === 'replies') {
          window.requestAnimationFrame(() => {
            scrollContainerToBottom(scrollRef.current, { behavior: 'smooth' });
          });
        }
      }
    });

    const unsubAck = realtime.onAck((data) => {
      const message = data.message;
      if (!message || message.conversationId !== conversationIdRef.current) return;
      const rootId = rootMessageIdRef.current;
      if (message.id === rootId || message.threadRootId === rootId) {
        upsertReplyRef.current(message);
      }
    });

    const unsubUpdated = realtime.onMessageUpdated((message) => {
      if (message.conversationId !== conversationIdRef.current) return;
      const rootId = rootMessageIdRef.current;
      if (message.id === rootId) {
        setRoot((prev) => (prev ? { ...prev, ...message } : message));
        return;
      }
      if (message.threadRootId === rootId) {
        setReplies((prev) => mergeReplyList(prev, [message]));
        if (message.thread) {
          syncRootMetaRef.current({
            replyCount: message.thread.replyCount,
            latestReplyAt: message.thread.latestReplyAt,
          });
        }
      }
    });

    const unsubHidden = realtime.onMessageHidden(({ messageId }) => {
      setReplies((prev) => prev.filter((m) => m.id !== messageId));
      if (messageId === rootMessageIdRef.current) onClose();
    });

    const unsubReaction = realtime.onReaction((update) => {
      if (update.conversationId !== conversationIdRef.current) return;
      const apply = (m: Message) =>
        m.id === update.messageId ? { ...m, reactions: update.reactions } : m;
      setRoot((prev) => (prev ? apply(prev) : prev));
      setReplies((prev) => prev.map(apply));
    });

    return () => {
      unsubMsg();
      unsubAck();
      unsubUpdated();
      unsubHidden();
      unsubReaction();
    };
  }, [mergeReplyList, onClose]);

  useEffect(() => {
    if (tab !== 'search' || searchQuery.trim().length < 2) {
      setSearchHits([]);
      return;
    }

    let cancelled = false;
    setSearchBusy(true);
    const timer = window.setTimeout(() => {
      api
        .searchThread(conversationId, rootMessageId, searchQuery.trim())
        .then((res) => {
          if (!cancelled) setSearchHits(res.items);
        })
        .catch(() => {
          if (!cancelled) setSearchHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearchBusy(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tab, searchQuery, conversationId, rootMessageId]);

  const fileMessages = [root, ...replies].filter(
    (m): m is Message => Boolean(m && isAttachmentMessage(m) && !m.deletedForEveryone),
  );

  const handleSend = async () => {
    if (!input.trim() || !canSend || attachmentBusy) return;
    const content = input.trim();
    const clientMessageId = createClientMessageId();
    const replyTarget = replyingTo;
    const optimistic: Message = {
      id: clientMessageId,
      conversationId,
      senderId: currentUserId,
      content,
      contentType: 'text/plain',
      clientMessageId,
      sequence: '0',
      createdAt: new Date().toISOString(),
      status: 'sending',
      threadRootId: rootMessageId,
      replyTo: replyTarget
        ? {
            id: replyTarget.id,
            senderId: replyTarget.senderId,
            content: replyTarget.deletedForEveryone ? '' : replyTarget.content,
            contentType: replyTarget.contentType,
            fileName: replyTarget.fileName,
            caption: replyTarget.caption,
            deletedForEveryone: replyTarget.deletedForEveryone,
            sender: replyTarget.sender,
          }
        : undefined,
    };

    setInput('');
    setReplyingTo(null);
    setSendError('');
    setReplies((prev) => mergeReplyList(prev, [optimistic]));
    window.requestAnimationFrame(() => {
      scrollContainerToBottom(scrollRef.current, { behavior: 'smooth' });
    });

    try {
      const sent = await realtime.sendMessage(
        conversationId,
        content,
        clientMessageId,
        replyTarget?.id ?? rootMessageId,
        rootMessageId,
      );
      upsertReply({ ...sent, status: mergeMessageStatus(sent.status, 'sent') });
    } catch (err) {
      setReplies((prev) => prev.filter((m) => m.clientMessageId !== clientMessageId));
      setInput(content);
      if (replyTarget) setReplyingTo(replyTarget);
      setSendError(err instanceof Error ? err.message : 'Failed to send reply');
    }
  };

  const handleAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !canSend || attachmentBusy) return;

    const caption = input.trim() || undefined;
    const clientMessageId = createClientMessageId();
    const replyTarget = replyingTo;
    const previewUrl = URL.createObjectURL(file);

    setInput('');
    setReplyingTo(null);
    setSendError('');
    setAttachmentBusy(true);

    const optimistic: Message = {
      id: clientMessageId,
      conversationId,
      senderId: currentUserId,
      content: previewUrl,
      contentType: file.type || 'application/octet-stream',
      fileName: file.name,
      fileSize: String(file.size),
      caption,
      clientMessageId,
      sequence: '0',
      createdAt: new Date().toISOString(),
      status: 'sending',
      threadRootId: rootMessageId,
      replyTo: replyTarget
        ? {
            id: replyTarget.id,
            senderId: replyTarget.senderId,
            content: replyTarget.deletedForEveryone ? '' : replyTarget.content,
            contentType: replyTarget.contentType,
            fileName: replyTarget.fileName,
            caption: replyTarget.caption,
            deletedForEveryone: replyTarget.deletedForEveryone,
            sender: replyTarget.sender,
          }
        : undefined,
    };

    setReplies((prev) => mergeReplyList(prev, [optimistic]));

    try {
      const sent = await api.sendMessageAttachment(conversationId, file, {
        caption,
        clientMessageId,
        replyToMessageId: replyTarget?.id ?? rootMessageId,
        threadRootId: rootMessageId,
      });
      upsertReply(sent);
    } catch (err) {
      setReplies((prev) => prev.filter((m) => m.clientMessageId !== clientMessageId));
      setInput(caption ?? '');
      if (replyTarget) setReplyingTo(replyTarget);
      setSendError(err instanceof Error ? err.message : 'Failed to send file');
    } finally {
      URL.revokeObjectURL(previewUrl);
      setAttachmentBusy(false);
    }
  };

  const scrollToThreadMessage = (messageId: string) => {
    setTab('replies');
    window.requestAnimationFrame(() => {
      scrollContainerToMessage(scrollRef.current, messageId, {
        behavior: 'smooth',
        alignToUnreadDivider: false,
      });
    });
  };

  const replyCount = root?.replyCount ?? replies.filter((m) => !m.deletedForEveryone).length;

  return (
    <div className="thread-panel conversation-info-panel">
      <header className="conversation-info-header thread-panel-header">
        <button type="button" className="back-btn icon-btn" onClick={onClose} aria-label="Close thread">
          <Icon icon={faArrowLeft} />
        </button>
        <div className="thread-panel-title">
          <h3>Thread</h3>
          <span className="thread-panel-subtitle">{formatReplyLabel(replyCount)}</span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon icon={faXmark} />
        </button>
      </header>

      <div className="thread-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={tab === 'replies' ? 'active' : ''}
          aria-selected={tab === 'replies'}
          onClick={() => setTab('replies')}
        >
          <Icon icon={faComments} />
          Replies
        </button>
        <button
          type="button"
          role="tab"
          className={tab === 'search' ? 'active' : ''}
          aria-selected={tab === 'search'}
          onClick={() => setTab('search')}
        >
          <Icon icon={faMagnifyingGlass} />
          Search
        </button>
        <button
          type="button"
          role="tab"
          className={tab === 'files' ? 'active' : ''}
          aria-selected={tab === 'files'}
          onClick={() => setTab('files')}
        >
          <Icon icon={faFile} />
          Files
        </button>
      </div>

      {loading ? (
        <div className="thread-panel-empty">Loading thread…</div>
      ) : error || !root ? (
        <div className="thread-panel-empty">{error || 'Thread not found'}</div>
      ) : tab === 'replies' ? (
        <>
          <div className="thread-messages messages" ref={scrollRef}>
            <div className="thread-root-label">Original message</div>
            <MessageBubble
              message={root}
              isOwn={root.senderId === currentUserId}
              scrollRootRef={scrollRef}
              canSendActions={canSend}
              onStartEdit={
                onStartEdit && isTextMessage(root)
                  ? (id, content) => {
                      onClose();
                      onStartEdit(id, content);
                    }
                  : undefined
              }
              onReply={(message) => setReplyingTo(message)}
              onForward={onForward}
              onScrollToMessage={scrollToThreadMessage}
              onDelete={onDelete}
              onReaction={onReaction}
            />
            {replies.length > 0 && (
              <div className="thread-replies-divider">
                <span>{formatReplyLabel(replies.length)}</span>
              </div>
            )}
            {replies.map((m) => (
              <MessageBubble
                key={m.clientMessageId ?? m.id}
                message={m}
                isOwn={m.senderId === currentUserId}
                isFirstUnread={firstUnreadMessageId === m.id}
                scrollRootRef={scrollRef}
                canSendActions={canSend}
                onReply={(message) => setReplyingTo(message)}
                onForward={onForward}
                onScrollToMessage={scrollToThreadMessage}
                onDelete={onDelete}
                onReaction={onReaction}
              />
            ))}
            <div ref={endRef} />
          </div>

          {canSend ? (
            <footer className="composer thread-composer">
              {replyingTo && (
                <div className="composer-reply-banner">
                  <div className="composer-reply-preview">
                    <span className="composer-reply-label">Replying to</span>
                    <MessageReplyQuote
                      replyTo={{
                        id: replyingTo.id,
                        senderId: replyingTo.senderId,
                        content: replyingTo.deletedForEveryone ? '' : replyingTo.content,
                        contentType: replyingTo.contentType,
                        fileName: replyingTo.fileName,
                        caption: replyingTo.caption,
                        deletedForEveryone: replyingTo.deletedForEveryone,
                        sender: replyingTo.sender,
                      }}
                      isOwn
                    />
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setReplyingTo(null)}
                    aria-label="Cancel reply"
                  >
                    <Icon icon={faXmark} />
                  </button>
                </div>
              )}
              <form
                className="composer-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSend();
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ATTACHMENT_ACCEPT}
                  hidden
                  onChange={(e) => void handleAttachment(e)}
                />
                <button
                  type="button"
                  className="icon-btn"
                  disabled={attachmentBusy}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach file"
                  title="Attach file"
                >
                  <Icon icon={faPaperclip} />
                </button>
                <input
                  className="composer-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Reply in thread…"
                  disabled={attachmentBusy}
                />
                <button type="submit" disabled={!input.trim() || attachmentBusy}>
                  Send
                </button>
              </form>
              {sendError && <p className="composer-error">{sendError}</p>}
            </footer>
          ) : (
            <p className="composer-readonly-notice">You cannot reply in this conversation.</p>
          )}
        </>
      ) : tab === 'search' ? (
        <div className="thread-search conversation-info-content">
          <label className="thread-search-field">
            <Icon icon={faMagnifyingGlass} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in this thread…"
              autoFocus
            />
          </label>
          {searchBusy && <p className="thread-panel-hint">Searching…</p>}
          {!searchBusy && searchQuery.trim().length >= 2 && searchHits.length === 0 && (
            <p className="thread-panel-hint">No matches in this thread.</p>
          )}
          <ul className="thread-search-results">
            {searchHits.map((hit) => (
              <li key={hit.id}>
                <button type="button" onClick={() => scrollToThreadMessage(hit.id)}>
                  <strong>{hit.sender?.displayName ?? 'Unknown'}</strong>
                  {hit.isRoot && <span className="thread-hit-badge">Root</span>}
                  <span className="thread-hit-snippet">{hit.snippet}</span>
                  <time>{new Date(hit.createdAt).toLocaleString()}</time>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="thread-files conversation-info-content">
          {fileMessages.length === 0 ? (
            <p className="thread-panel-hint">No files in this thread yet.</p>
          ) : (
            <ul className="thread-file-list">
              {fileMessages.map((m) => {
                const attachmentMeta = {
                  mimeType: m.contentType,
                  originalName: m.fileName ?? 'file',
                };
                return (
                  <li key={m.id}>
                    <button type="button" onClick={() => scrollToThreadMessage(m.id)}>
                      <span className="thread-file-name">
                        {m.fileName || getMessagePreviewText(m)}
                      </span>
                      <span className="thread-file-meta">
                        {getAttachmentMediaLabel(attachmentMeta)}
                        {m.fileSize ? ` · ${formatFileSize(m.fileSize)}` : ''}
                        {' · '}
                        {m.sender?.displayName ?? 'Unknown'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
