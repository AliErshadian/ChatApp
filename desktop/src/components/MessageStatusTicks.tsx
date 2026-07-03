import type { MessageStatus } from '../services/api';

interface Props {
  status: MessageStatus;
}

export function MessageStatusTicks({ status }: Props) {
  if (status === 'sending') {
    return <span className="msg-status sending" title="Sending">◷</span>;
  }

  if (status === 'sent') {
    return (
      <span className="msg-status sent" title="Sent">
        <svg viewBox="0 0 16 11" width="16" height="11" aria-hidden>
          <path d="M1 5.5L5.5 10L15 1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  const isRead = status === 'read';

  return (
    <span className={`msg-status ${isRead ? 'read' : 'delivered'}`} title={isRead ? 'Read' : 'Delivered'}>
      <svg viewBox="0 0 20 11" width="18" height="11" aria-hidden>
        <path d="M1 5.5L4 8.5L10 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 5.5L9.5 9L17 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
