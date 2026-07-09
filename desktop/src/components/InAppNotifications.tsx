import type { InAppNotification } from '../utils/inAppNotification';

type Props = {
  items: InAppNotification[];
  onDismiss: (id: string) => void;
  onClick: (item: InAppNotification) => void;
};

export function InAppNotifications({ items, onDismiss, onClick }: Props) {
  if (items.length === 0) return null;

  return (
    <div className="mention-notifications" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className="mention-notification">
          <button
            type="button"
            className="mention-notification-body"
            onClick={() => onClick(item)}
          >
            {item.text}
          </button>
          <button
            type="button"
            className="mention-notification-dismiss"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(item.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
