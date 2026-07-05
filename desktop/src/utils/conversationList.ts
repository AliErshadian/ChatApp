import { Conversation, Message } from '../services/api';
import { getMessagePreviewText } from './messageMedia';

export function formatConversationPreview(
  conversation: Conversation,
  currentUserId: string,
): string {
  const lastMessage = conversation.lastMessage;
  if (!lastMessage) {
    return conversation.type === 'channel'
      ? 'No messages yet'
      : 'Start a conversation';
  }

  if (lastMessage.deletedForEveryone) {
    return lastMessage.senderId === currentUserId ? 'You: Message deleted' : 'Message deleted';
  }

  const previewSource: Message = {
    id: lastMessage.id,
    conversationId: conversation.id,
    senderId: lastMessage.senderId,
    content: lastMessage.content,
    contentType: lastMessage.contentType ?? 'text/plain',
    fileName: lastMessage.fileName,
    caption: lastMessage.caption,
    sequence: '',
    createdAt: lastMessage.createdAt,
  };

  let text = getMessagePreviewText(previewSource).replace(/\s+/g, ' ').trim();
  if (text.length > 72) text = `${text.slice(0, 69)}...`;

  if (conversation.type === 'channel' || conversation.type === 'group') {
    const prefix =
      lastMessage.senderId === currentUserId
        ? 'You: '
        : `${lastMessage.senderName ?? 'Someone'}: `;
    return prefix + text;
  }

  return lastMessage.senderId === currentUserId ? `You: ${text}` : text;
}

export function bumpConversationFromMessage(
  conversation: Conversation,
  message: Pick<
    Message,
    'id' | 'content' | 'contentType' | 'fileName' | 'caption' | 'senderId' | 'createdAt'
  > & {
    sender?: { displayName: string };
  },
): Conversation {
  return {
    ...conversation,
    updatedAt: message.createdAt,
    lastMessage: {
      id: message.id,
      content: message.content,
      contentType: message.contentType,
      fileName: message.fileName,
      caption: message.caption,
      senderId: message.senderId,
      senderName: message.sender?.displayName,
      createdAt: message.createdAt,
    },
  };
}

export function reorderConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => {
    const aTime = new Date(a.lastMessage?.createdAt ?? a.updatedAt).getTime();
    const bTime = new Date(b.lastMessage?.createdAt ?? b.updatedAt).getTime();
    return bTime - aTime;
  });
}
