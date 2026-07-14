import { useEffect, useMemo, useState } from 'react';
import { api, Contact, User } from '../services/api';
import { useAuth } from '../context/AuthContext';

export interface CreateTaskInput {
  title: string;
  description?: string;
  assignedTo?: string;
  dueAt?: string;
}

interface Props {
  open: boolean;
  busy?: boolean;
  error?: string;
  title?: string;
  initialTitle?: string;
  initialDescription?: string;
  onClose: () => void;
  onSubmit: (input: CreateTaskInput) => void | Promise<void>;
}

function toDatetimeLocalValue(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocalValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function CreateTaskModal({
  open,
  busy = false,
  error = '',
  title = 'New task',
  initialTitle = '',
  initialDescription = '',
  onClose,
  onSubmit,
}: Props) {
  const { user } = useAuth();
  const [taskTitle, setTaskTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTaskTitle(initialTitle);
    setDescription(initialDescription);
    setDueAt('');
    setAssigneeId('');
    setSearchQuery('');
    setSearchResults([]);
    setLocalError('');
    void api.listContacts().then(setContacts).catch(() => setContacts([]));
  }, [open, initialTitle, initialDescription]);

  const normalizedSearch = useMemo(
    () => searchQuery.trim().replace(/^@/, ''),
    [searchQuery],
  );

  useEffect(() => {
    if (!open || normalizedSearch.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await api.searchUsers(normalizedSearch);
        setSearchResults(results.filter((u) => u.id !== user?.id));
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [normalizedSearch, open, user?.id]);

  const assigneeOptions = useMemo(() => {
    const byId = new Map<string, User>();
    for (const contact of contacts) byId.set(contact.id, contact);
    for (const result of searchResults) byId.set(result.id, result);
    return [...byId.values()];
  }, [contacts, searchResults]);

  const selectedAssignee = assigneeOptions.find((u) => u.id === assigneeId);

  if (!open) return null;

  const canSubmit = taskTitle.trim().length > 0 && !busy;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) {
      setLocalError('Enter a title');
      return;
    }
    setLocalError('');
    await onSubmit({
      title: taskTitle.trim(),
      description: description.trim() || undefined,
      assignedTo: assigneeId || undefined,
      dueAt: fromDatetimeLocalValue(dueAt),
    });
  };

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal create-task-modal"
        role="dialog"
        aria-labelledby="create-task-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="create-task-modal-header">
          <h3 id="create-task-title">{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form className="create-task-form" onSubmit={(e) => void handleSubmit(e)}>
          <label className="create-task-field">
            <span>Title</span>
            <input
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="What needs to be done?"
              maxLength={500}
              autoFocus
              disabled={busy}
            />
          </label>

          <label className="create-task-field">
            <span>Description (optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add details"
              rows={3}
              maxLength={4000}
              disabled={busy}
            />
          </label>

          <label className="create-task-field">
            <span>Assign</span>
            <p className="field-hint" style={{ margin: 0 }}>
              They must accept before the task is added to their list.
            </p>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search people to assign..."
              disabled={busy}
            />
            {selectedAssignee && (
              <div className="create-task-assignee-chip">
                <span>
                  {selectedAssignee.displayName} (@{selectedAssignee.username})
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setAssigneeId('')}
                  aria-label="Clear assignee"
                  disabled={busy}
                >
                  ×
                </button>
              </div>
            )}
            {!selectedAssignee && (searching || assigneeOptions.length > 0) && (
              <ul className="create-task-assignee-list">
                {searching && normalizedSearch.length >= 2 ? (
                  <li className="create-task-assignee-hint">Searching...</li>
                ) : assigneeOptions.length === 0 ? (
                  <li className="create-task-assignee-hint">No users found</li>
                ) : (
                  assigneeOptions.slice(0, 8).map((option) => (
                    <li key={option.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setAssigneeId(option.id);
                          setSearchQuery('');
                          setSearchResults([]);
                        }}
                        disabled={busy}
                      >
                        {option.displayName}
                        <span>@{option.username}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </label>

          <label className="create-task-field">
            <span>Due date</span>
            <input
              type="datetime-local"
              value={dueAt || toDatetimeLocalValue()}
              onChange={(e) => setDueAt(e.target.value)}
              disabled={busy}
            />
          </label>

          {(localError || error) && (
            <p className="composer-error">{localError || error}</p>
          )}

          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!canSubmit}>
              {busy ? 'Saving…' : 'Add task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
