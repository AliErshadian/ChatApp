import { Conversation } from '../services/api';
import { getDirectPeer } from './conversation';

export function getConversationMentionLabel(
  conversation: Conversation | undefined,
  currentUserId?: string,
): string {
  if (!conversation) return 'a chat';
  if (conversation.type === 'channel') return `#${conversation.name}`;
  if (conversation.type === 'group') return conversation.name;
  if (currentUserId) {
    const peer = getDirectPeer(conversation, currentUserId);
    const name = peer?.displayName ?? peer?.username;
    if (name) return name;
  }
  return conversation.name;
}
