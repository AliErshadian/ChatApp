import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, Contact, User } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { usePresence } from '../context/PresenceContext';
import { Avatar } from './Avatar';

interface Props {
  onClose: () => void;
  isMobile?: boolean;
  onMessage: (user: User) => void;
  variant?: 'full' | 'picker';
}

export function ContactsPanel({
  onClose,
  isMobile = false,
  onMessage,
  variant = 'full',
}: Props) {
  const isPicker = variant === 'picker';
  const { user } = useAuth();
  const { getPresence, refreshPresence } = usePresence();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [actionUserId, setActionUserId] = useState<string | null>(null);

  const closeLabel = isMobile
    ? 'Back to conversations'
    : isPicker
      ? 'Close new chat'
      : 'Close contacts';
  const closeIcon = isMobile ? '←' : '✕';
  const panelTitle = isPicker ? 'New Chat' : 'Contacts';

  const contactIds = useMemo(
    () => new Set(contacts.map((c) => c.id)),
    [contacts],
  );

  const loadContacts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await api.listContacts();
      setContacts(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const presenceUserIds = useMemo(
    () => [...contacts.map((c) => c.id), ...searchResults.map((u) => u.id)],
    [contacts, searchResults],
  );

  useEffect(() => {
    refreshPresence(presenceUserIds);
  }, [presenceUserIds, refreshPresence]);

  const normalizedSearchUsername = useMemo(() => {
    return searchQuery.trim().replace(/^@/, '');
  }, [searchQuery]);

  const isValidUsernameQuery = normalizedSearchUsername.length >= 2;

  useEffect(() => {
    if (!isValidUsernameQuery) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await api.searchUsers(normalizedSearchUsername);
        setSearchResults(results.filter((u) => u.id !== user?.id));
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [normalizedSearchUsername, isValidUsernameQuery, user?.id]);

  const handleAdd = async (target: User) => {
    setActionUserId(target.id);
    setError('');
    try {
      const added = await api.addContact(target.id);
      setContacts((prev) => [added, ...prev.filter((c) => c.id !== added.id)]);
      setSearchQuery('');
      setSearchResults([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add contact');
    } finally {
      setActionUserId(null);
    }
  };

  const handleRemove = async (contactId: string) => {
    setActionUserId(contactId);
    setError('');
    try {
      await api.removeContact(contactId);
      setContacts((prev) => prev.filter((c) => c.id !== contactId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove contact');
    } finally {
      setActionUserId(null);
    }
  };

  const handleMessage = (target: User) => {
    onMessage(target);
  };

  return (
    <div className="contacts-panel">
      <header className="profile-header">
        <button
          className="icon-btn close-chat-btn"
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
        >
          {closeIcon}
        </button>
        <h3>{panelTitle}</h3>
      </header>

      <div className="contacts-content">
        {!isPicker && (
        <section className="contacts-search-section">
          <input
            className="contacts-search-input"
            placeholder="Search by username or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searching && <p className="contacts-hint">Searching...</p>}
          {!searching && isValidUsernameQuery && searchResults.length === 0 && (
            <p className="contacts-hint">No users found</p>
          )}
          {searchResults.length > 0 && (
            <ul className="contacts-search-results">
              {searchResults.map((u) => {
                const isContact = contactIds.has(u.id);
                const busy = actionUserId === u.id;
                return (
                  <li key={u.id} className="contact-row">
                    <Avatar
                      name={u.displayName}
                      avatarUrl={u.avatarUrl}
                      size="sm"
                      presence={getPresence(u.id)}
                    />
                    <div className="contact-row-info">
                      <span className="contact-row-name">{u.displayName}</span>
                      <span className="contact-row-username">@{u.username}</span>
                    </div>
                    {isContact ? (
                      <span className="contact-added-label">Added</span>
                    ) : (
                      <button
                        type="button"
                        className="contact-action-btn primary"
                        onClick={() => handleAdd(u)}
                        disabled={busy}
                      >
                        {busy ? '...' : 'Add'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        )}

        <section className="contacts-list-section">
          <div className="contacts-list-header">
            <span>{isPicker ? 'Choose a contact' : 'Your contacts'}</span>
            <span className="conversation-count">{contacts.length}</span>
          </div>

          {error && <p className="profile-error-inline">{error}</p>}

          {loading ? (
            <p className="contacts-hint">Loading contacts...</p>
          ) : contacts.length === 0 ? (
            <div className="contacts-empty">
              <p>No contacts yet</p>
              <span>
                {isPicker
                  ? 'Add people from Contacts to start chatting'
                  : 'Enter a full username above to find people'}
              </span>
            </div>
          ) : (
            <ul className={`contacts-list${isPicker ? ' contacts-list--picker' : ''}`}>
              {contacts.map((c) => {
                const busy = actionUserId === c.id;
                return (
                  <li key={c.id} className="contact-row">
                    <button
                      type="button"
                      className="contact-row-main"
                      onClick={() => handleMessage(c)}
                      disabled={busy}
                    >
                      <Avatar
                        name={c.displayName}
                        avatarUrl={c.avatarUrl}
                        size="sm"
                        presence={getPresence(c.id)}
                      />
                      <div className="contact-row-info">
                        <span className="contact-row-name">{c.displayName}</span>
                        <span className="contact-row-username">@{c.username}</span>
                      </div>
                    </button>
                    {!isPicker && (
                    <div className="contact-row-actions">
                      <button
                        type="button"
                        className="contact-action-btn primary"
                        onClick={() => handleMessage(c)}
                        disabled={busy}
                      >
                        Message
                      </button>
                      <button
                        type="button"
                        className="contact-action-btn"
                        onClick={() => handleRemove(c.id)}
                        disabled={busy}
                      >
                        Remove
                      </button>
                    </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
