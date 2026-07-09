import { useMemo, useState } from 'react';
import { Conversation, Message } from '../services/api';
import { Avatar } from './Avatar';
import { canSendInConversation } from '../utils/conversation';
import { getMessagePreviewText } from '../utils/messageMedia';
import { truncateMessagePreview } from '../utils/messagePreview';

interface Props {
  open: boolean;
  message: Message;
  conversations: Conversation[];
  currentUserId: string;
  sourceConversationId: string;
  onClose: () => void;
  onForward: (targetConversationIds: string[]) => Promise<void>;
}

export function ForwardDestinationModal({
  open,
  message,
  conversations,
  currentUserId,
  sourceConversationId,
  onClose,
  onForward,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const destinations = useMemo(
    () =>
      conversations.filter(
        (conversation) =>
          conversation.id !== sourceConversationId &&
          canSendInConversation(conversation, currentUserId),
      ),
    [conversations, currentUserId, sourceConversationId],
  );

  const chatDestinations = useMemo(
    () => destinations.filter((c) => c.type === 'direct' || c.type === 'group'),
    [destinations],
  );

  const channelDestinations = useMemo(
    () => destinations.filter((c) => c.type === 'channel'),
    [destinations],
  );

  const preview = truncateMessagePreview(getMessagePreviewText(message));

  const toggle = (conversationId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(conversationId)) next.delete(conversationId);
      else next.add(conversationId);
      return next;
    });
  };

  const handleForward = async () => {
    if (selectedIds.size === 0 || busy) return;

    setBusy(true);
    setError('');
    try {
      await onForward([...selectedIds]);
      setSelectedIds(new Set());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to forward message');
    } finally {
      setBusy(false);
    }
  };

  const renderItem = (conversation: Conversation) => {
    const selected = selectedIds.has(conversation.id);

    return (
      <li key={conversation.id}>
        <button
          type="button"
          className={`member-picker-item${selected ? ' selected' : ''}`}
          onClick={() => toggle(conversation.id)}
        >
          <Avatar name={conversation.name} avatarUrl={conversation.avatarUrl} size="sm" />
          <span className="member-picker-name">{conversation.name}</span>
          <span className="member-picker-check">{selected ? '✓' : ''}</span>
        </button>
      </li>
    );
  };

  if (!open) return null;

  return (
    <div className="modal-overlay forward-modal-overlay" onClick={onClose}>
      <div className="modal forward-modal" onClick={(e) => e.stopPropagation()}>
        <header className="new-group-header">
          <h3>Forward message</h3>
        </header>

        <div className="forward-preview">
          <span className="forward-preview-label">Message</span>
          <p className="forward-preview-text">{preview}</p>
        </div>

        <div className="forward-destination-list">
          {destinations.length === 0 ? (
            <p className="field-hint">No chats available to forward to.</p>
          ) : (
            <>
              {chatDestinations.length > 0 && (
                <section className="forward-destination-section">
                  <div className="forward-section-label">Chats</div>
                  <ul className="member-picker-list">{chatDestinations.map(renderItem)}</ul>
                </section>
              )}
              {channelDestinations.length > 0 && (
                <section className="forward-destination-section">
                  <div className="forward-section-label">Channels</div>
                  <ul className="member-picker-list">{channelDestinations.map(renderItem)}</ul>
                </section>
              )}
            </>
          )}
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions new-group-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleForward()}
            disabled={busy || selectedIds.size === 0}
          >
            {busy ? 'Forwarding...' : `Forward${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
