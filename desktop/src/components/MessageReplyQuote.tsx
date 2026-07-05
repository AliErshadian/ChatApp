import { MessageReplyPreview } from '../services/api';
import { truncateMessagePreview } from '../utils/messagePreview';

interface Props {
  replyTo: MessageReplyPreview;
  isOwn?: boolean;
  compact?: boolean;
  onScrollToMessage?: (messageId: string) => void;
}

export function MessageReplyQuote({
  replyTo,
  isOwn = false,
  compact = false,
  onScrollToMessage,
}: Props) {
  const senderName = replyTo.sender?.displayName ?? 'Unknown';
  const deleted = replyTo.deletedForEveryone;
  const preview = deleted ? 'Message deleted' : truncateMessagePreview(replyTo.content);

  const handleClick = () => {
    if (!deleted && onScrollToMessage) {
      onScrollToMessage(replyTo.id);
    }
  };

  return (
    <button
      type="button"
      className={[
        'message-reply-quote',
        isOwn ? 'own' : 'incoming',
        compact ? 'compact' : '',
        deleted ? 'deleted' : '',
        onScrollToMessage && !deleted ? 'clickable' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleClick}
      disabled={!onScrollToMessage || deleted}
      aria-label={deleted ? 'Replied message deleted' : `Jump to message from ${senderName}`}
    >
      <span className="message-reply-quote-author">{senderName}</span>
      <span className="message-reply-quote-text">{preview}</span>
    </button>
  );
}
