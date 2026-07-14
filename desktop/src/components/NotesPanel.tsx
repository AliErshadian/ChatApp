import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  NoteItem,
  NoteMemberItem,
  NoteRevisionItem,
  NoteScopeFilter,
  User,
} from '../services/api';
import { realtime } from '../services/realtime';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { ConfirmModal } from './ConfirmModal';
import { compactDiffLines, diffText } from '../utils/noteDiff';
import {
  faArrowLeft,
  faClockRotateLeft,
  faPlus,
  faMagnifyingGlass,
  faShareNodes,
  faTrashCan,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';

interface Props {
  onClose: () => void;
  isMobile?: boolean;
}

const FILTERS: Array<{ id: NoteScopeFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
  { id: 'shared', label: 'Shared with me' },
];

function displayName(user: { displayName?: string; username?: string } | null | undefined) {
  return user?.displayName || user?.username || 'Someone';
}

function formatWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function describeChanges(fields: string[]) {
  if (fields.length === 0) return 'Updated';
  const labels = fields.map((field) => (field === 'body' ? 'content' : field));
  return `Changed ${labels.join(' and ')}`;
}

function NoteFieldDiff({
  label,
  before,
  after,
}: {
  label: string;
  before: string;
  after: string;
}) {
  const lines = compactDiffLines(diffText(before, after));
  if (lines.length === 0) return null;

  return (
    <div className="notes-diff-block">
      <div className="notes-diff-label">{label}</div>
      <div className="notes-diff-lines" role="group" aria-label={`${label} changes`}>
        {lines.map((line, index) => (
          <div
            key={`${line.type}-${index}`}
            className={`notes-diff-line notes-diff-line--${line.type}`}
          >
            <span className="notes-diff-prefix" aria-hidden="true">
              {line.type === 'remove' ? '−' : line.type === 'add' ? '+' : ' '}
            </span>
            <span className="notes-diff-text">{line.text || '\u00a0'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function upsertNote(list: NoteItem[], note: NoteItem, prepend = true): NoteItem[] {
  const index = list.findIndex((item) => item.id === note.id);
  if (index === -1) {
    return prepend ? [note, ...list] : [...list, note];
  }
  const next = [...list];
  next[index] = note;
  return next;
}

function dedupeNotes(list: NoteItem[]): NoteItem[] {
  const seen = new Set<string>();
  const result: NoteItem[] = [];
  for (const note of list) {
    if (seen.has(note.id)) continue;
    seen.add(note.id);
    result.push(note);
  }
  return result;
}

export function NotesPanel({ onClose, isMobile = false }: Props) {
  const { user } = useAuth();
  const [filter, setFilter] = useState<NoteScopeFilter>('all');
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<NoteRevisionItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [members, setMembers] = useState<NoteMemberItem[]>([]);
  const [showShare, setShowShare] = useState(false);
  const [shareQuery, setShareQuery] = useState('');
  const [shareResults, setShareResults] = useState<User[]>([]);
  const [shareRole, setShareRole] = useState<'reader' | 'contributor'>('contributor');
  const [shareBusy, setShareBusy] = useState(false);
  const [deletingNote, setDeletingNote] = useState<NoteItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);
  const [clearHistoryBusy, setClearHistoryBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const selectedIdRef = useRef<string | null>(null);
  const showHistoryRef = useRef(false);
  selectedIdRef.current = selectedId;
  showHistoryRef.current = showHistory;

  const closeLabel = isMobile ? 'Back to conversations' : 'Close notes';
  const selected = useMemo(
    () => notes.find((note) => note.id === selectedId) ?? null,
    [notes, selectedId],
  );

  const loadNotes = useCallback(async (scope: NoteScopeFilter) => {
    setLoading(true);
    setError('');
    try {
      const list = await api.listNotes({ scope });
      setNotes(dedupeNotes(list));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notes');
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const noteBelongsInFilter = useCallback(
    (note: NoteItem, activeFilter: NoteScopeFilter) => {
      if (!user) return false;
      if (activeFilter === 'mine') return note.createdBy.id === user.id;
      if (activeFilter === 'shared') return note.createdBy.id !== user.id;
      return true;
    },
    [user],
  );

  useEffect(() => {
    void loadNotes(filter);
  }, [filter, loadNotes]);

  useEffect(() => {
    if (!user) return;

    const unsubUpdated = realtime.onNoteUpdated((incoming) => {
      setNotes((prev) => {
        const belongs = noteBelongsInFilter(incoming, filter);
        if (!belongs) {
          return prev.filter((item) => item.id !== incoming.id);
        }
        return upsertNote(prev, incoming, true);
      });

      if (selectedIdRef.current === incoming.id) {
        setDraftTitle(incoming.title);
        setDraftBody(incoming.body ?? '');
        if (showHistoryRef.current) {
          void api.getNoteHistory(incoming.id).then(setHistory).catch(() => undefined);
        }
      }
    });

    const unsubDeleted = realtime.onNoteDeleted(({ noteId }) => {
      setNotes((prev) => prev.filter((item) => item.id !== noteId));
      if (selectedIdRef.current === noteId) {
        setSelectedId(null);
        setShowHistory(false);
        setShowShare(false);
        setClearHistoryOpen(false);
      }
    });

    return () => {
      unsubUpdated();
      unsubDeleted();
    };
  }, [filter, noteBelongsInFilter, user]);

  const openNote = async (note: NoteItem) => {
    setSelectedId(note.id);
    setDraftTitle(note.title);
    setDraftBody(note.body ?? '');
    setShowHistory(false);
    setShowShare(false);
    setClearHistoryOpen(false);
    setError('');
    try {
      const fresh = await api.getNote(note.id);
      setNotes((prev) => upsertNote(prev, fresh, false));
      setDraftTitle(fresh.title);
      setDraftBody(fresh.body ?? '');
    } catch {
      // Keep list item data.
    }
  };

  const loadHistory = async (noteId: string) => {
    setHistoryLoading(true);
    try {
      const rows = await api.getNoteHistory(noteId);
      setHistory(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadMembers = async (noteId: string) => {
    try {
      const rows = await api.getNoteMembers(noteId);
      setMembers(rows);
    } catch {
      setMembers([]);
    }
  };

  useEffect(() => {
    if (!selectedId || !showHistory) return;
    void loadHistory(selectedId);
  }, [selectedId, showHistory]);

  useEffect(() => {
    if (!selectedId || !showShare) return;
    void loadMembers(selectedId);
  }, [selectedId, showShare]);

  useEffect(() => {
    const query = shareQuery.trim().replace(/^@/, '');
    if (query.length < 2) {
      setShareResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const results = await api.searchUsers(query);
        setShareResults(results.filter((u) => u.id !== user?.id));
      } catch {
        setShareResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [shareQuery, user?.id]);

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const note = await api.createNote({ title: 'Untitled note' });
      setNotes((prev) => upsertNote(prev, note, true));
      await openNote(note);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create note');
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateNote(selected.id, {
        title: draftTitle,
        body: draftBody,
        version: selected.version,
      });
      setNotes((prev) => upsertNote(prev, updated, false));
      if (showHistory) void loadHistory(updated.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save note');
      if (err instanceof Error && err.message.includes('updated by someone else')) {
        try {
          const fresh = await api.getNote(selected.id);
          setNotes((prev) => upsertNote(prev, fresh, false));
          setDraftTitle(fresh.title);
          setDraftBody(fresh.body ?? '');
        } catch {
          // Ignore refresh failure.
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleShare = async (target: User) => {
    if (!selected) return;
    setShareBusy(true);
    setError('');
    try {
      const updated = await api.addNoteMember(selected.id, {
        userId: target.id,
        role: shareRole,
      });
      setNotes((prev) => upsertNote(prev, updated, false));
      setShareQuery('');
      setShareResults([]);
      await loadMembers(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to share note');
    } finally {
      setShareBusy(false);
    }
  };

  const handleRemoveMember = async (member: NoteMemberItem) => {
    if (!selected) return;
    setShareBusy(true);
    setError('');
    try {
      await api.removeNoteMember(selected.id, member.userId);
      await loadMembers(selected.id);
      const fresh = await api.getNote(selected.id);
      setNotes((prev) => upsertNote(prev, fresh, false));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setShareBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingNote) return;
    setDeleteBusy(true);
    setError('');
    try {
      await api.deleteNote(deletingNote.id);
      setNotes((prev) => prev.filter((item) => item.id !== deletingNote.id));
      if (selectedId === deletingNote.id) {
        setSelectedId(null);
        setShowHistory(false);
        setShowShare(false);
        setClearHistoryOpen(false);
      }
      setDeletingNote(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete note');
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleClearHistory = async () => {
    if (!selected) return;
    setClearHistoryBusy(true);
    setError('');
    try {
      await api.clearNoteHistory(selected.id);
      setHistory([]);
      setClearHistoryOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear history');
    } finally {
      setClearHistoryBusy(false);
    }
  };

  const backToList = () => {
    setSelectedId(null);
    setShowHistory(false);
    setShowShare(false);
    setClearHistoryOpen(false);
    setError('');
  };

  return (
    <div className="notes-panel tasks-panel">
      <header className="chat-header">
        <div className="chat-header-leading">
          <button
            className="icon-btn close-chat-btn"
            onClick={selected ? backToList : onClose}
            title={selected ? 'Back to notes list' : closeLabel}
            aria-label={selected ? 'Back to notes list' : closeLabel}
          >
            <Icon icon={faArrowLeft} />
          </button>
        </div>
        <div className="chat-header-center">
          <div className="chat-header-info">
            <h3>{selected ? 'Edit note' : 'Notes'}</h3>
            <span className="member-count">
              {selected
                ? selected.canEdit
                  ? selected.isShared
                    ? 'Shared note'
                    : 'Personal note'
                  : 'Read only'
                : 'Personal and shared notes'}
            </span>
          </div>
        </div>
        <div className="chat-header-trailing">
          {!selected && (
            <button
              type="button"
              className="icon-btn tasks-add-btn"
              onClick={() => void handleCreate()}
              disabled={creating}
              title="New note"
              aria-label="New note"
            >
              <Icon icon={faPlus} />
            </button>
          )}
        </div>
      </header>

      {!selected ? (
        <>
          <div className="tasks-filter-bar">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`tasks-filter-btn${filter === item.id ? ' active' : ''}`}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="tasks-content">
            {loading ? (
              <p className="panel-muted">Loading notes...</p>
            ) : error && notes.length === 0 ? (
              <p className="panel-error">{error}</p>
            ) : notes.length === 0 ? (
              <div className="empty-state">
                <h3>No notes yet</h3>
                <p>Create a note for yourself or share it with others to read or contribute.</p>
                <button type="button" className="btn-primary" onClick={() => void handleCreate()}>
                  New note
                </button>
              </div>
            ) : (
              <ul className="tasks-list">
                {notes.map((note) => (
                  <li key={note.id}>
                    <button type="button" className="note-list-row" onClick={() => void openNote(note)}>
                      <div className="note-list-row-main">
                        <span className="task-title">{note.title}</span>
                        {note.body && <span className="note-list-preview">{note.body}</span>}
                      </div>
                      <div className="note-list-meta">
                        {note.isShared && <span className="note-badge">Shared</span>}
                        <span className="note-list-time">{formatWhen(note.updatedAt)}</span>
                        {note.lastEditedBy && (
                          <span className="note-list-editor">
                            {displayName(note.lastEditedBy)}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <div className="notes-editor-layout">
          <div className="notes-editor-main">
            {error && <p className="panel-error notes-editor-error">{error}</p>}
            <input
              className="notes-title-input"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Title"
              disabled={!selected.canEdit || saving}
            />
            <textarea
              className="notes-body-input"
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              placeholder="Write your note..."
              disabled={!selected.canEdit || saving}
            />
            <div className="notes-editor-actions">
              {selected.canEdit && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void handleSave()}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              )}
              {selected.myRole === 'owner' && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowShare((v) => !v)}
                >
                  <Icon icon={faShareNodes} /> Share
                </button>
              )}
              <button
                type="button"
                className={`btn-secondary${showHistory ? ' active' : ''}`}
                onClick={() => setShowHistory((v) => !v)}
              >
                <Icon icon={faClockRotateLeft} /> History
              </button>
              {selected.myRole === 'owner' && (
                <button
                  type="button"
                  className="btn-danger-ghost notes-delete-btn"
                  onClick={() => setDeletingNote(selected)}
                  title="Delete note"
                  aria-label="Delete note"
                >
                  <Icon icon={faTrashCan} />
                </button>
              )}
            </div>
          </div>

          {showShare && selected.myRole === 'owner' && (
            <aside className="notes-side-panel">
              <div className="notes-side-header">
                <h4>Share note</h4>
                <button type="button" className="icon-btn" onClick={() => setShowShare(false)}>
                  <Icon icon={faXmark} />
                </button>
              </div>
              <div className="notes-share-role">
                <label>
                  <input
                    type="radio"
                    checked={shareRole === 'contributor'}
                    onChange={() => setShareRole('contributor')}
                  />
                  Can contribute
                </label>
                <label>
                  <input
                    type="radio"
                    checked={shareRole === 'reader'}
                    onChange={() => setShareRole('reader')}
                  />
                  Read only
                </label>
              </div>
              <div className="notes-share-search-wrap">
                <Icon icon={faMagnifyingGlass} className="notes-share-search-icon" />
                <input
                  type="search"
                  className="notes-share-search"
                  value={shareQuery}
                  onChange={(e) => setShareQuery(e.target.value)}
                  placeholder="Search people..."
                  disabled={shareBusy}
                  aria-label="Search people to share with"
                />
              </div>
              <ul className="notes-share-results">
                {shareResults.map((person) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      className="notes-share-person"
                      onClick={() => void handleShare(person)}
                      disabled={shareBusy}
                    >
                      <Avatar name={person.displayName} avatarUrl={person.avatarUrl} size="sm" />
                      <span>
                        {person.displayName}
                        <small>@{person.username}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="notes-members-list">
                <h5>People with access</h5>
                <ul>
                  {members.map((member) => (
                    <li key={member.userId} className="notes-member-row">
                      <Avatar
                        name={member.user.displayName}
                        avatarUrl={member.user.avatarUrl}
                        size="sm"
                      />
                      <div className="notes-member-info">
                        <span>{displayName(member.user)}</span>
                        <small>{member.role}</small>
                      </div>
                      {member.role !== 'owner' && (
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => void handleRemoveMember(member)}
                          disabled={shareBusy}
                          aria-label="Remove access"
                        >
                          <Icon icon={faXmark} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          )}

          {showHistory && (
            <aside className="notes-side-panel">
              <div className="notes-side-header">
                <h4>Change history</h4>
                <div className="notes-side-header-actions">
                  {selected.myRole === 'owner' && history.length > 0 && (
                    <button
                      type="button"
                      className="btn-danger-ghost notes-clear-history-btn"
                      onClick={() => setClearHistoryOpen(true)}
                      disabled={clearHistoryBusy || historyLoading}
                    >
                      Clear history
                    </button>
                  )}
                  <button type="button" className="icon-btn" onClick={() => setShowHistory(false)}>
                    <Icon icon={faXmark} />
                  </button>
                </div>
              </div>
              {historyLoading ? (
                <p className="panel-muted">Loading history...</p>
              ) : history.length === 0 ? (
                <p className="panel-muted">No changes yet.</p>
              ) : (
                <ul className="notes-history-list">
                  {history.map((revision, index) => {
                    const previous = history[index + 1];
                    const beforeTitle = previous?.title ?? '';
                    const beforeBody = previous?.body ?? '';
                    const afterTitle = revision.title;
                    const afterBody = revision.body ?? '';

                    return (
                    <li key={revision.id} className="notes-history-item">
                      <div className="notes-history-top">
                        <Avatar
                          name={revision.editedBy.displayName}
                          avatarUrl={revision.editedBy.avatarUrl}
                          size="sm"
                        />
                        <div>
                          <strong>{displayName(revision.editedBy)}</strong>
                          <span>{describeChanges(revision.changedFields)}</span>
                        </div>
                      </div>
                      <div className="notes-history-meta">
                        v{revision.version} · {formatWhen(revision.createdAt)}
                      </div>
                      <div className="notes-history-diff">
                        {revision.changedFields.includes('title') && (
                          <NoteFieldDiff
                            label="Title"
                            before={beforeTitle}
                            after={afterTitle}
                          />
                        )}
                        {revision.changedFields.includes('body') && (
                          <NoteFieldDiff
                            label="Content"
                            before={beforeBody}
                            after={afterBody}
                          />
                        )}
                      </div>
                    </li>
                    );
                  })}
                </ul>
              )}
            </aside>
          )}
        </div>
      )}

      <ConfirmModal
        open={Boolean(deletingNote)}
        title="Delete note?"
        message="This note and its history will be permanently deleted for everyone."
        confirmLabel="Delete"
        danger
        busy={deleteBusy}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeletingNote(null)}
      />

      <ConfirmModal
        open={clearHistoryOpen}
        title="Clear change history?"
        message="All previous revisions will be removed. The current note content stays the same."
        confirmLabel="Clear history"
        danger
        busy={clearHistoryBusy}
        onConfirm={() => void handleClearHistory()}
        onCancel={() => setClearHistoryOpen(false)}
      />
    </div>
  );
}
