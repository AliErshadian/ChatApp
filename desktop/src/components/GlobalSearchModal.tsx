import { useEffect, useMemo, useRef, useState } from 'react';
import { Conversation, MessageSearchResult, User } from '../services/api';
import { api } from '../services/api';
import { Avatar } from './Avatar';
import { usePresence } from '../context/PresenceContext';
import {
  filterConversationsBySearch,
  getConversationSearchSubtitle,
  isSearchQueryActive,
  normalizeSearchQuery,
} from '../utils/search';
import { getMessagePreviewText } from '../utils/messageMedia';
import { truncateMessagePreview } from '../utils/messagePreview';
import { MessageSearchResultItem } from './MessageSearchResultItem';

interface Props {
  open: boolean;
  conversations: Conversation[];
  currentUserId: string;
  onClose: () => void;
  onOpenConversation: (conversationId: string, preferredList?: 'chats' | 'channels') => void;
  onOpenMessage: (
    conversationId: string,
    messageId: string,
    conversationType: Conversation['type'],
  ) => void;
  onMessageUser: (user: User) => void;
}

export function GlobalSearchModal({
  open,
  conversations,
  currentUserId,
  onClose,
  onOpenConversation,
  onOpenMessage,
  onMessageUser,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { getPresence, refreshPresence } = usePresence();
  const [query, setQuery] = useState('');
  const [userResults, setUserResults] = useState<User[]>([]);
  const [messageResults, setMessageResults] = useState<MessageSearchResult[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [searchingMessages, setSearchingMessages] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setUserResults([]);
      setMessageResults([]);
      setSearchingUsers(false);
      setSearchingMessages(false);
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const normalizedQuery = normalizeSearchQuery(query);

  useEffect(() => {
    if (!open || normalizedQuery.length < 2) {
      setUserResults([]);
      setSearchingUsers(false);
      return;
    }

    setSearchingUsers(true);
    const timer = window.setTimeout(async () => {
      try {
        const results = await api.searchUsers(normalizedQuery);
        setUserResults(results.filter((user) => user.id !== currentUserId));
      } catch {
        setUserResults([]);
      } finally {
        setSearchingUsers(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [open, normalizedQuery, currentUserId]);

  useEffect(() => {
    if (!open || normalizedQuery.length < 2) {
      setMessageResults([]);
      setSearchingMessages(false);
      return;
    }

    setSearchingMessages(true);
    const timer = window.setTimeout(async () => {
      try {
        const results = await api.searchMessages(normalizedQuery, 20);
        setMessageResults(results.items);
      } catch {
        setMessageResults([]);
      } finally {
        setSearchingMessages(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [open, normalizedQuery]);

  const conversationResults = useMemo(() => {
    const filtered = filterConversationsBySearch(conversations, query, currentUserId);
    const byId = new Map(filtered.map((conversation) => [conversation.id, conversation]));
    for (const result of messageResults) {
      if (byId.has(result.conversationId)) continue;
      const conversation = conversations.find((item) => item.id === result.conversationId);
      if (conversation) byId.set(conversation.id, conversation);
    }
    return [...byId.values()].slice(0, 12);
  }, [conversations, query, currentUserId, messageResults]);

  const chatResults = useMemo(
    () => conversationResults.filter((c) => c.type === 'direct' || c.type === 'group'),
    [conversationResults],
  );

  const channelResults = useMemo(
    () => conversationResults.filter((c) => c.type === 'channel'),
    [conversationResults],
  );

  useEffect(() => {
    if (!open) return;
    refreshPresence(userResults.map((user) => user.id));
  }, [open, userResults, refreshPresence]);

  if (!open) return null;

  const hasQuery = isSearchQueryActive(query);
  const noResults =
    hasQuery &&
    !searchingUsers &&
    !searchingMessages &&
    conversationResults.length === 0 &&
    userResults.length === 0 &&
    messageResults.length === 0 &&
    normalizedQuery.length >= 2;

  const openConversation = (conversation: Conversation) => {
    onOpenConversation(
      conversation.id,
      conversation.type === 'channel' ? 'channels' : 'chats',
    );
    onClose();
  };

  const messageUser = (target: User) => {
    onMessageUser(target);
    onClose();
  };

  const openMessage = (result: MessageSearchResult) => {
    onOpenMessage(result.conversationId, result.id, result.conversationType);
    onClose();
  };

  return (
    <div className="modal-overlay global-search-overlay" onClick={onClose}>
      <div className="modal global-search-modal" onClick={(e) => e.stopPropagation()}>
        <header className="global-search-header">
          <input
            ref={inputRef}
            className="global-search-input"
            type="search"
            placeholder="Search chats, channels, messages, and people..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search"
          />
          <kbd className="global-search-kbd">Esc</kbd>
        </header>

        <div className="global-search-results">
          {!hasQuery && (
            <p className="global-search-hint">
              Type to search conversations and people. Shortcut: Ctrl+K or Cmd+K
            </p>
          )}

          {searchingUsers && hasQuery && (
            <p className="global-search-hint">Searching people...</p>
          )}

          {searchingMessages && hasQuery && normalizedQuery.length >= 2 && (
            <p className="global-search-hint">Searching messages...</p>
          )}

          {noResults && <p className="global-search-hint">No results found.</p>}

          {chatResults.length > 0 && (
            <section className="global-search-section">
              <div className="global-search-section-label">Chats</div>
              <ul className="global-search-list">
                {chatResults.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      className="global-search-item"
                      onClick={() => openConversation(conversation)}
                    >
                      <Avatar
                        name={conversation.name}
                        avatarUrl={conversation.avatarUrl}
                        size="sm"
                      />
                      <span className="global-search-item-body">
                        <strong>{conversation.name}</strong>
                        <span>{getConversationSearchSubtitle(conversation, currentUserId)}</span>
                        {conversation.lastMessage && (
                          <span className="global-search-preview">
                            {truncateMessagePreview(
                              getMessagePreviewText(conversation.lastMessage),
                            )}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {channelResults.length > 0 && (
            <section className="global-search-section">
              <div className="global-search-section-label">Channels</div>
              <ul className="global-search-list">
                {channelResults.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      className="global-search-item"
                      onClick={() => openConversation(conversation)}
                    >
                      <Avatar
                        name={conversation.name}
                        avatarUrl={conversation.avatarUrl}
                        size="sm"
                      />
                      <span className="global-search-item-body">
                        <strong>#{conversation.name}</strong>
                        <span>Channel</span>
                        {conversation.lastMessage && (
                          <span className="global-search-preview">
                            {truncateMessagePreview(
                              getMessagePreviewText(conversation.lastMessage),
                            )}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {messageResults.length > 0 && (
            <section className="global-search-section">
              <div className="global-search-section-label">Messages</div>
              <ul className="global-search-list">
                {messageResults.map((result) => (
                  <li key={result.id}>
                    <MessageSearchResultItem
                      result={result}
                      className="message-search-result-global"
                      onClick={() => openMessage(result)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {userResults.length > 0 && (
            <section className="global-search-section">
              <div className="global-search-section-label">People</div>
              <ul className="global-search-list">
                {userResults.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      className="global-search-item"
                      onClick={() => messageUser(user)}
                    >
                      <Avatar
                        name={user.displayName}
                        avatarUrl={user.avatarUrl}
                        size="sm"
                        presence={getPresence(user.id)}
                      />
                      <span className="global-search-item-body">
                        <strong>{user.displayName}</strong>
                        <span>@{user.username}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
