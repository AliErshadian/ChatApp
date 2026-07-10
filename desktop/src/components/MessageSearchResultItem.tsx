import { Conversation, MessageSearchResult } from '../services/api';
import { formatRelativeTime } from '../utils/time';
import { getMessageMediaLabel } from '../utils/messageMedia';

export function getConversationTypeLabel(type: Conversation['type']): string {
  if (type === 'channel') return 'Channel';
  if (type === 'group') return 'Group';
  return 'Direct message';
}

export function getMessageSearchChatTitle(result: MessageSearchResult): string {
  if (result.conversationType === 'channel') {
    return `#${result.conversationName}`;
  }
  return result.conversationName;
}

export function getMessageSearchPreview(result: MessageSearchResult): string {
  return (
    result.snippet ||
    getMessageMediaLabel({
      contentType: result.contentType,
      fileName: result.fileName,
    })
  );
}

interface Props {
  result: MessageSearchResult;
  onClick: () => void;
  className?: string;
}

export function MessageSearchResultItem({ result, onClick, className }: Props) {
  const chatTitle = getMessageSearchChatTitle(result);
  const preview = getMessageSearchPreview(result);

  return (
    <button
      type="button"
      className={['message-search-result', className].filter(Boolean).join(' ')}
      onClick={onClick}
    >
      <div className="message-search-result-header">
        <strong className="message-search-result-chat">{chatTitle}</strong>
        <span className="message-search-result-type">
          {getConversationTypeLabel(result.conversationType)}
        </span>
      </div>
      <p className="message-search-result-body">
        <span className="message-search-result-sender">{result.senderDisplayName}</span>
        <span className="message-search-result-separator">: </span>
        <span className="message-search-result-content">{preview}</span>
      </p>
      <time className="message-search-result-time" dateTime={result.createdAt}>
        {formatRelativeTime(result.createdAt)}
      </time>
    </button>
  );
}
