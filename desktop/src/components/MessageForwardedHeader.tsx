import { MessageForwardedFrom } from '../services/api';
import { Icon } from './Icon';
import { faShare } from '@fortawesome/free-solid-svg-icons';

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
      <Icon icon={faShare} className="message-forwarded-icon" />
      <span className="message-forwarded-label">
        Forwarded from <strong>{senderName}</strong>
      </span>
    </div>
  );
}
