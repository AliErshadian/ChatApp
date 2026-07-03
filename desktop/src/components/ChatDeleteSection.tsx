import { useState } from 'react';
import { ConfirmModal } from './ConfirmModal';
import { getDeleteChatConfirm } from '../utils/deleteChatConfirm';

interface Props {
  description: string;
  busy?: boolean;
  onDeleteChat: (scope: 'me' | 'everyone') => void | Promise<void>;
}

export function ChatDeleteSection({ description, busy = false, onDeleteChat }: Props) {
  const [pendingScope, setPendingScope] = useState<'me' | 'everyone' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const confirm = pendingScope ? getDeleteChatConfirm(pendingScope) : null;

  const handleConfirm = async () => {
    if (!pendingScope) return;
    setConfirming(true);
    try {
      await onDeleteChat(pendingScope);
      setPendingScope(null);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <>
      <section className="profile-section chat-delete-section">
        <h4>Delete Chat</h4>
        <p className="chat-delete-desc">{description}</p>
        <div className="chat-delete-actions">
          <button
            type="button"
            className="chat-delete-btn"
            disabled={busy || confirming}
            onClick={() => setPendingScope('me')}
          >
            Delete for me
          </button>
          <button
            type="button"
            className="chat-delete-btn danger"
            disabled={busy || confirming}
            onClick={() => setPendingScope('everyone')}
          >
            {busy || confirming ? 'Deleting...' : 'Delete for everyone'}
          </button>
        </div>
      </section>

      {confirm && (
        <ConfirmModal
          open
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          busy={busy || confirming}
          onConfirm={handleConfirm}
          onCancel={() => {
            if (!busy && !confirming) setPendingScope(null);
          }}
        />
      )}
    </>
  );
}
