import { useState } from 'react';
import { Conversation } from '../services/api';
import { ChannelLeaveModal } from './ChannelLeaveModal';

interface Props {
  conversation: Conversation;
  currentUserId: string;
  busy?: boolean;
  onLeave: (newOwnerId?: string) => void | Promise<void>;
}

export function ChannelLeaveSection({
  conversation,
  currentUserId,
  busy = false,
  onLeave,
}: Props) {
  const [modalOpen, setModalOpen] = useState(false);

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
            disabled={busy}
            onClick={() => setModalOpen(true)}
          >
            Leave channel
          </button>
        </div>
      </section>

      <ChannelLeaveModal
        open={modalOpen}
        conversation={conversation}
        currentUserId={currentUserId}
        busy={busy}
        onConfirm={async (newOwnerId) => {
          await onLeave(newOwnerId);
          setModalOpen(false);
        }}
        onCancel={() => {
          if (!busy) setModalOpen(false);
        }}
      />
    </>
  );
}
