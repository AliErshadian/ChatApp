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

  const isGroup = conversation.type === 'group';
  const leaveLabel = isGroup ? 'Leave Group' : 'Leave Channel';

  return (
    <>
      <section className="profile-section chat-delete-section">
        <h4>{leaveLabel}</h4>
        <p className="chat-delete-desc">
          {isGroup
            ? 'Leave this group and remove it from your list. You can rejoin with an invite link if the group is public.'
            : 'Leave this channel and remove it from your list. You can rejoin with an invite link.'}
        </p>
        <div className="chat-delete-actions">
          <button
            type="button"
            className="chat-delete-btn danger"
            disabled={busy}
            onClick={() => setModalOpen(true)}
          >
            {isGroup ? 'Leave group' : 'Leave channel'}
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
