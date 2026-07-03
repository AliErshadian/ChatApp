import { Conversation } from '../services/api';

export function getDirectPeer(conversation: Conversation, currentUserId: string) {
  if (conversation.type !== 'direct') return undefined;
  return conversation.members.find((m) => m.userId !== currentUserId);
}
