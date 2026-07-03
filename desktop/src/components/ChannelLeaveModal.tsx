import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Conversation } from '../services/api';
import { Avatar } from './Avatar';
import { ConfirmModal } from './ConfirmModal';
import { getLeaveChannelConfirm } from '../utils/deleteChatConfirm';

interface Props {
  open: boolean;
  conversation: Conversation;
  currentUserId: string;
  busy?: boolean;
  onConfirm: (newOwnerId?: string) => void | Promise<void>;
  onCancel: () => void;
}

export function ChannelLeaveModal({
  open,
  conversation,
  currentUserId,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);

  const membership = conversation.members.find((m) => m.userId === currentUserId);
  const isOwner = membership?.role === 'owner';
  const otherMembers = useMemo(
    () => conversation.members.filter((m) => m.userId !== currentUserId),
    [conversation.members, currentUserId],
  );
  const showOwnerPicker = isOwner && otherMembers.length > 0;

  useEffect(() => {
    if (open) setSelectedOwnerId(undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy && !confirming) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, confirming, onCancel]);

  if (!open) return null;

  if (!showOwnerPicker) {
    const confirm = getLeaveChannelConfirm();
    return (
      <ConfirmModal
        open
        title={confirm.title}
        message={confirm.message}
        confirmLabel={confirm.confirmLabel}
        danger={confirm.danger}
        busy={busy || confirming}
        onConfirm={async () => {
          setConfirming(true);
          try {
            await onConfirm();
          } finally {
            setConfirming(false);
          }
        }}
        onCancel={() => {
          if (!busy && !confirming) onCancel();
        }}
      />
    );
  }

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await onConfirm(selectedOwnerId);
    } finally {
      setConfirming(false);
    }
  };

  return createPortal(
    <div className="modal-overlay confirm-modal-overlay" onClick={busy || confirming ? undefined : onCancel}>
      <div
        className="modal confirm-modal channel-owner-leave-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="channel-owner-leave-title"
        aria-describedby="channel-owner-leave-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="channel-owner-leave-title">Leave channel as owner</h3>
        <p id="channel-owner-leave-desc" className="confirm-modal-message">
          You are the channel owner. Optionally choose who should own the channel after you leave.
          If you don&apos;t pick anyone, the channel will have no owner.
        </p>

        <div className="channel-owner-picker">
          <p className="channel-owner-picker-label">New owner (optional)</p>
          <ul className="channel-owner-options">
            {otherMembers.map((member) => {
              const selected = selectedOwnerId === member.userId;
              return (
                <li key={member.userId}>
                  <button
                    type="button"
                    className={`channel-owner-option${selected ? ' selected' : ''}`}
                    onClick={() =>
                      setSelectedOwnerId((prev) =>
                        prev === member.userId ? undefined : member.userId,
                      )
                    }
                    disabled={busy || confirming}
                    aria-pressed={selected}
                  >
                    <Avatar
                      name={member.displayName ?? member.username ?? '?'}
                      avatarUrl={member.avatarUrl}
                      size="sm"
                    />
                    <span className="channel-owner-option-info">
                      <span className="channel-owner-option-name">
                        {member.displayName ?? 'Unknown'}
                      </span>
                      <span className="channel-owner-option-username">@{member.username}</span>
                    </span>
                    <span className="channel-owner-option-check" aria-hidden="true">
                      {selected ? '✓' : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={busy || confirming}>
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => void handleConfirm()}
            disabled={busy || confirming}
          >
            {busy || confirming ? 'Leaving...' : 'Leave channel'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
