import { MessageForwardedFrom } from '../services/api';

interface Props {
  forwardedFrom: MessageForwardedFrom;
  isOwn?: boolean;
}

export function MessageForwardedHeader({ forwardedFrom, isOwn = false }: Props) {
  const senderName = forwardedFrom.sender?.displayName ?? 'Unknown';

  return (
    <div
      className={['message-forwarded-header', isOwn ? 'own' : 'incoming'].filter(Boolean).join(' ')}
    >
      <svg className="message-forwarded-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M14 2 6 2v2.5L2.5 2 1 3.5 5.5 8 1 12.5 2.5 14 6 11.5V14h8V2zm-2 10H6V9.5L3.5 12 2.5 11 5.5 8 2.5 5 3.5 4 6 6.5V4h6v8z"
        />
      </svg>
      <span className="message-forwarded-label">
        Forwarded from <strong>{senderName}</strong>
      </span>
    </div>
  );
}
