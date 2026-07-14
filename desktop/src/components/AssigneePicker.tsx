import { useEffect, useMemo, useState } from 'react';
import { api, Contact, User } from '../services/api';

interface Props {
  selectedId: string | null;
  onSelect: (userId: string | null) => void;
  disabled?: boolean;
  excludeUserId?: string;
  seedUsers?: User[];
}

export function AssigneePicker({
  selectedId,
  onSelect,
  disabled = false,
  excludeUserId,
  seedUsers = [],
}: Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    void api.listContacts().then(setContacts).catch(() => setContacts([]));
  }, []);

  const normalizedSearch = useMemo(
    () => searchQuery.trim().replace(/^@/, ''),
    [searchQuery],
  );

  useEffect(() => {
    if (normalizedSearch.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await api.searchUsers(normalizedSearch);
        setSearchResults(
          results.filter((user) => user.id !== excludeUserId),
        );
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [normalizedSearch, excludeUserId]);

  const options = useMemo(() => {
    const byId = new Map<string, User>();
    for (const user of seedUsers) {
      if (user.id !== excludeUserId) byId.set(user.id, user);
    }
    for (const contact of contacts) {
      if (contact.id !== excludeUserId) byId.set(contact.id, contact);
    }
    for (const result of searchResults) byId.set(result.id, result);
    return [...byId.values()];
  }, [contacts, searchResults, excludeUserId, seedUsers]);

  const selected = options.find((user) => user.id === selectedId);

  return (
    <div className="assignee-picker">
      <input
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search people to assign..."
        disabled={disabled}
      />
      {selected && (
        <div className="create-task-assignee-chip">
          <span>
            {selected.displayName} (@{selected.username})
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onSelect(null)}
            aria-label="Clear assignee"
            disabled={disabled}
          >
            ×
          </button>
        </div>
      )}
      {!selected && (
        <ul className="create-task-assignee-list">
          {searching && normalizedSearch.length >= 2 ? (
            <li className="create-task-assignee-hint">Searching...</li>
          ) : options.length === 0 ? (
            <li className="create-task-assignee-hint">
              {normalizedSearch.length >= 2 ? 'No users found' : 'Search or pick a contact'}
            </li>
          ) : (
            options.slice(0, 8).map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(option.id);
                    setSearchQuery('');
                    setSearchResults([]);
                  }}
                  disabled={disabled}
                >
                  {option.displayName}
                  <span>@{option.username}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
