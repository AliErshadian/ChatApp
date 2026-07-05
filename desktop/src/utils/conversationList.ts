import { Conversation, Message } from '../services/api';

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

  let text = lastMessage.content.replace(/\s+/g, ' ').trim();
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
  message: Pick<Message, 'id' | 'content' | 'senderId' | 'createdAt'> & {
    sender?: { displayName: string };
  },
): Conversation {
  return {
    ...conversation,
    updatedAt: message.createdAt,
    lastMessage: {
      id: message.id,
      content: message.content,
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
