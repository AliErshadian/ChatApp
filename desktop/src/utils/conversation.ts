import { Conversation } from '../services/api';

export function getDirectPeer(conversation: Conversation, currentUserId: string) {
  if (conversation.type !== 'direct') return undefined;
  return conversation.members.find((m) => m.userId !== currentUserId);
}

export function getChannelOwner(conversation: Conversation) {
  return conversation.members.find((m) => m.role === 'owner');
}

export function sortChannelMembers(conversation: Conversation) {
  return [...conversation.members].sort((a, b) => {
    if (a.role === 'owner') return -1;
    if (b.role === 'owner') return 1;
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (b.role === 'admin' && a.role !== 'admin') return 1;
    return (a.displayName ?? a.username ?? '').localeCompare(b.displayName ?? b.username ?? '');
  });
}
