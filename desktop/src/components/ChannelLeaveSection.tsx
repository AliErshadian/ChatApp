import { useState } from 'react';
import { ConfirmModal } from './ConfirmModal';
import { getLeaveChannelConfirm } from '../utils/deleteChatConfirm';

interface Props {
  busy?: boolean;
  onLeave: () => void | Promise<void>;
}

export function ChannelLeaveSection({ busy = false, onLeave }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const confirm = getLeaveChannelConfirm();

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await onLeave();
      setConfirmOpen(false);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <>
      <section className="profile-section chat-delete-section">
        <h4>Leave Channel</h4>
        <p className="chat-delete-desc">
          Leave this channel and remove it from your list. You can rejoin with an invite link.
        </p>
        <div className="chat-delete-actions">
          <button
            type="button"
            className="chat-delete-btn danger"
            disabled={busy || confirming}
            onClick={() => setConfirmOpen(true)}
          >
            {busy || confirming ? 'Leaving...' : 'Leave channel'}
          </button>
        </div>
      </section>

      <ConfirmModal
        open={confirmOpen}
        title={confirm.title}
        message={confirm.message}
        confirmLabel={confirm.confirmLabel}
        danger={confirm.danger}
        busy={busy || confirming}
        onConfirm={handleConfirm}
        onCancel={() => {
          if (!busy && !confirming) setConfirmOpen(false);
        }}
      />
    </>
  );
}
