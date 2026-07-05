import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, Contact, Conversation } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';

type Step = 'name' | 'avatar' | 'description' | 'visibility' | 'members';

const STEPS: Step[] = ['name', 'avatar', 'description', 'visibility', 'members'];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (conversation: Conversation) => void;
}

export function NewGroupModal({ open, onClose, onCreated }: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const stepIndex = STEPS.indexOf(step);

  const reset = useCallback(() => {
    setStep('name');
    setName('');
    setDescription('');
    setIsPublic(false);
    setAvatarFile(null);
    setAvatarPreview(null);
    setSelectedMemberIds(new Set());
    setError('');
    setBusy(false);
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }

    setLoadingContacts(true);
    api
      .listContacts()
      .then(setContacts)
      .catch(() => setContacts([]))
      .finally(() => setLoadingContacts(false));
  }, [open, reset]);

  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  const selectableContacts = useMemo(
    () => contacts.filter((c) => c.id !== user?.id),
    [contacts, user?.id],
  );

  const canGoNext = step !== 'name' || name.trim().length > 0;

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const toggleMember = (userId: string) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const goNext = () => {
    if (!canGoNext) return;
    const next = STEPS[stepIndex + 1];
    if (next) setStep(next);
  };

  const goBack = () => {
    const prev = STEPS[stepIndex - 1];
    if (prev) setStep(prev);
  };

  const handleCreate = async () => {
    if (!name.trim() || busy) return;

    setBusy(true);
    setError('');
    try {
      let group = await api.createGroup({
        name: name.trim(),
        description: description.trim() || undefined,
        memberIds: [...selectedMemberIds],
        isPublic,
      });

      if (avatarFile) {
        const uploaded = await api.uploadChannelAvatar(group.id, avatarFile);
        group = { ...group, avatarUrl: uploaded.avatarUrl };
      }

      onCreated(group);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal new-group-modal" onClick={(e) => e.stopPropagation()}>
        <header className="new-group-header">
          <h3>Create Group</h3>
          <span className="new-group-step">
            Step {stepIndex + 1} of {STEPS.length}
          </span>
        </header>

        {step === 'name' && (
          <div className="new-group-step-content">
            <label className="field-label" htmlFor="group-name">
              Group name
            </label>
            <input
              id="group-name"
              placeholder="Enter group name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={128}
            />
          </div>
        )}

        {step === 'avatar' && (
          <div className="new-group-step-content new-group-avatar-step">
            <p className="field-hint">Optional — you can add a photo later.</p>
            <div className="new-group-avatar-preview">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Group preview" className="new-group-avatar-img" />
              ) : (
                <Avatar name={name || 'Group'} size="lg" />
              )}
            </div>
            <label className="btn-secondary new-group-avatar-btn">
              {avatarFile ? 'Change photo' : 'Choose photo'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="avatar-file-input"
                onChange={handleAvatarChange}
              />
            </label>
            {avatarFile && (
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  if (avatarPreview) URL.revokeObjectURL(avatarPreview);
                  setAvatarFile(null);
                  setAvatarPreview(null);
                }}
              >
                Remove photo
              </button>
            )}
          </div>
        )}

        {step === 'description' && (
          <div className="new-group-step-content">
            <label className="field-label" htmlFor="group-description">
              Description
            </label>
            <textarea
              id="group-description"
              placeholder="What is this group about? (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={500}
            />
          </div>
        )}

        {step === 'visibility' && (
          <div className="new-group-step-content">
            <p className="field-label">Who can join?</p>
            <div className="visibility-options">
              <label className={`visibility-option${!isPublic ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="visibility"
                  checked={!isPublic}
                  onChange={() => setIsPublic(false)}
                />
                <span className="visibility-option-title">Private</span>
                <span className="visibility-option-desc">
                  Only people you add can join this group.
                </span>
              </label>
              <label className={`visibility-option${isPublic ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="visibility"
                  checked={isPublic}
                  onChange={() => setIsPublic(true)}
                />
                <span className="visibility-option-title">Public</span>
                <span className="visibility-option-desc">
                  Anyone with the invite link can join.
                </span>
              </label>
            </div>
          </div>
        )}

        {step === 'members' && (
          <div className="new-group-step-content new-group-members-step">
            <p className="field-hint">Select members to add (optional).</p>
            {loadingContacts ? (
              <p className="field-hint">Loading contacts...</p>
            ) : selectableContacts.length === 0 ? (
              <p className="field-hint">No contacts yet. You can add members later.</p>
            ) : (
              <ul className="member-picker-list">
                {selectableContacts.map((contact) => {
                  const selected = selectedMemberIds.has(contact.id);
                  return (
                    <li key={contact.id}>
                      <button
                        type="button"
                        className={`member-picker-item${selected ? ' selected' : ''}`}
                        onClick={() => toggleMember(contact.id)}
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
        )}

        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions new-group-actions">
          {stepIndex > 0 ? (
            <button type="button" onClick={goBack} disabled={busy}>
              Back
            </button>
          ) : (
            <button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          )}
          {step === 'members' ? (
            <button type="button" onClick={() => void handleCreate()} disabled={busy || !name.trim()}>
              {busy ? 'Creating...' : 'Create'}
            </button>
          ) : (
            <button type="button" onClick={goNext} disabled={!canGoNext || busy}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
