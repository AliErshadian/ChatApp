import { Conversation } from '../services/api';
import { compareConversations } from './conversationList';

export function getDirectPeer(conversation: Conversation, currentUserId: string) {
  if (conversation.type !== 'direct') return undefined;
  return conversation.members.find((m) => m.userId !== currentUserId);
}

export function isChannelOwner(conversation: Conversation, userId: string) {
  return conversation.members.some((m) => m.userId === userId && m.role === 'owner');
}

export function partitionChannels(conversations: Conversation[], userId: string) {
  const owned: Conversation[] = [];
  const joined: Conversation[] = [];

  for (const conversation of conversations) {
    if (isChannelOwner(conversation, userId)) {
      owned.push(conversation);
    } else {
      joined.push(conversation);
    }
  }

  return {
    owned: owned.sort(compareConversations),
    joined: joined.sort(compareConversations),
  };
}

export function isGroupConversation(conversation: Conversation) {
  return conversation.type === 'group';
}

export function isMultiMemberConversation(conversation: Conversation) {
  return conversation.type === 'channel' || conversation.type === 'group';
}

export function canManageParticipants(conversation: Conversation, userId: string) {
  if (!isMultiMemberConversation(conversation)) return false;
  return conversation.members.some(
    (m) => m.userId === userId && (m.role === 'owner' || m.role === 'admin'),
  );
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
