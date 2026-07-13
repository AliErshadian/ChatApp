import type { MessageStatus } from '../services/api';
import { Icon } from './Icon';
import { faCheck, faCheckDouble, faSpinner } from '@fortawesome/free-solid-svg-icons';

interface Props {
  status: MessageStatus;
}

export function MessageStatusTicks({ status }: Props) {
  if (status === 'sending') {
    return (
      <span className="msg-status sending" title="Sending">
        <Icon icon={faSpinner} spin />
      </span>
    );
  }

  if (status === 'sent') {
    return (
      <span className="msg-status sent" title="Sent">
        <Icon icon={faCheck} />
      </span>
    );
  }

  const isRead = status === 'read';

  return (
    <span className={`msg-status ${isRead ? 'read' : 'delivered'}`} title={isRead ? 'Read' : 'Delivered'}>
      <Icon icon={faCheckDouble} />
    </span>
  );
}
