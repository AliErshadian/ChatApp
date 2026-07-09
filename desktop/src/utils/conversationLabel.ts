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

export function getDirectPeerName(
  conversation: Conversation | undefined,
  currentUserId?: string,
): string {
  if (!conversation || !currentUserId) return 'Someone';
  const peer = getDirectPeer(conversation, currentUserId);
  return peer?.displayName ?? peer?.username ?? 'Someone';
}

export function buildMentionNotificationText(conversationLabel: string): string {
  return `You were mentioned in ${conversationLabel}`;
}

export function buildNewChatNotificationText(peerName: string): string {
  return `${peerName} started a chat with you`;
}

export function buildAddedToConversationText(conversation: Conversation): string {
  if (conversation.type === 'channel') {
    return `You were added to #${conversation.name}`;
  }
  return `You were added to ${conversation.name}`;
}
