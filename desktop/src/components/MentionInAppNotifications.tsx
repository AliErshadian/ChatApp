import type { MentionInAppNotification } from '../utils/mentionNotification';

type Props = {
  items: MentionInAppNotification[];
  onDismiss: (messageId: string) => void;
  onClick: (item: MentionInAppNotification) => void;
};

export function MentionInAppNotifications({ items, onDismiss, onClick }: Props) {
  if (items.length === 0) return null;

  return (
    <div className="mention-notifications" aria-live="polite">
      {items.map((item) => (
        <div key={item.messageId} className="mention-notification">
          <button
            type="button"
            className="mention-notification-body"
            onClick={() => onClick(item)}
          >
            You were mentioned in{' '}
            <span className="mention-notification-target">{item.conversationLabel}</span>
          </button>
          <button
            type="button"
            className="mention-notification-dismiss"
            aria-label="Dismiss mention notification"
            onClick={() => onDismiss(item.messageId)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
