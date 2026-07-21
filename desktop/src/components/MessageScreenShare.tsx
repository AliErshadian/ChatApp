import { Icon } from './Icon';
import { faDesktop } from '@fortawesome/free-solid-svg-icons';
import type { Message } from '../services/api';
import {
  parseScreenShareMessage,
  type ScreenShareMessagePayload,
} from '../utils/screenShareMessage';

interface Props {
  message: Message;
  currentUserId?: string;
  /** Session this client has joined/hosted; null when idle. */
  activeSessionId?: string | null;
  onJoin?: (sessionId: string) => void;
}

export function MessageScreenShare({
  message,
  currentUserId,
  activeSessionId = null,
  onJoin,
}: Props) {
  const data: ScreenShareMessagePayload | null = parseScreenShareMessage(message);
  if (!data) {
    return <p className="message-text">Screen share</p>;
  }

  const isActive = data.status === 'active';
  const isPresenter = Boolean(currentUserId && data.presenterId === currentUserId);
  const alreadyJoined = Boolean(activeSessionId && activeSessionId === data.sessionId);
  const showJoin = isActive && !isPresenter && !alreadyJoined && Boolean(onJoin);

  return (
    <div className={`message-screen-share${isActive ? ' message-screen-share--active' : ''}`}>
      <div className="message-screen-share-icon" aria-hidden>
        <Icon icon={faDesktop} />
      </div>
      <div className="message-screen-share-body">
        <strong className="message-screen-share-title">
          {isActive
            ? isPresenter
              ? 'You started a screen share'
              : `${data.presenterName} started a screen share`
            : isPresenter
              ? 'Your screen share ended'
              : `${data.presenterName}'s screen share ended`}
        </strong>
        <p className="message-screen-share-sub">
          {isActive
            ? isPresenter
              ? 'Others in this group can join from this message.'
              : 'Join to view the shared screen.'
            : 'This share is no longer available.'}
        </p>
        {showJoin && (
          <button
            type="button"
            className="message-screen-share-join"
            onClick={() => onJoin?.(data.sessionId)}
          >
            Join
          </button>
        )}
      </div>
    </div>
  );
}
