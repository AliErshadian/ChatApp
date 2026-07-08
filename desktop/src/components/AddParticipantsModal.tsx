import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, Contact } from '../services/api';
import { Avatar } from './Avatar';

interface Props {
  open: boolean;
  conversationId: string;
  existingMemberIds: string[];
  onClose: () => void;
  onAdded?: (addedUserIds: string[]) => void;
}

export function AddParticipantsModal({
  open,
  conversationId,
  existingMemberIds,
  onClose,
  onAdded,
}: Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const existingSet = useMemo(() => new Set(existingMemberIds), [existingMemberIds]);

  const reset = useCallback(() => {
    setSelectedIds(new Set());
    setError('');
    setBusy(false);
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }

    setLoading(true);
    api
      .listContacts()
      .then(setContacts)
      .catch(() => setContacts([]))
      .finally(() => setLoading(false));
  }, [open, reset]);

  const selectableContacts = useMemo(
    () => contacts.filter((c) => !existingSet.has(c.id)),
    [contacts, existingSet],
  );

  const toggle = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleAdd = async () => {
    if (selectedIds.size === 0 || busy) return;

    setBusy(true);
    setError('');
    try {
      const result = await api.addConversationMembers(conversationId, [...selectedIds]);
      onAdded?.(result.added);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add participants');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay add-participants-overlay" onClick={onClose}>
      <div className="modal new-group-modal" onClick={(e) => e.stopPropagation()}>
        <header className="new-group-header">
          <h3>Add participants</h3>
        </header>

        <div className="new-group-step-content new-group-members-step">
          {loading ? (
            <p className="field-hint">Loading contacts...</p>
          ) : selectableContacts.length === 0 ? (
            <p className="field-hint">No contacts available to add.</p>
          ) : (
            <ul className="member-picker-list">
              {selectableContacts.map((contact) => {
                const selected = selectedIds.has(contact.id);
                return (
                  <li key={contact.id}>
                    <button
                      type="button"
                      className={`member-picker-item${selected ? ' selected' : ''}`}
                      onClick={() => toggle(contact.id)}
                    >
                      <Avatar
                        name={contact.displayName}
                        avatarUrl={contact.avatarUrl}
                        size="sm"
                      />
                      <span className="member-picker-name">{contact.displayName}</span>
                      <span className="member-picker-check">{selected ? '✓' : ''}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions new-group-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={busy || selectedIds.size === 0}
          >
            {busy ? 'Adding...' : `Add${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
