import { Conversation } from '../services/api';
import { getDirectPeer } from './conversation';
import { getConversationMentionLabel } from './conversationLabel';
import { getMessagePreviewText } from './messageMedia';

export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function isSearchQueryActive(query: string): boolean {
  return normalizeSearchQuery(query).length > 0;
}

export function conversationMatchesSearch(
  conversation: Conversation,
  query: string,
  currentUserId?: string,
): boolean {
  const q = normalizeSearchQuery(query);
  if (!q) return true;

  const haystacks = new Set<string>();
  haystacks.add(conversation.name.toLowerCase());
  if (conversation.type === 'channel') {
    haystacks.add(`#${conversation.name}`.toLowerCase());
  }

  if (conversation.description?.trim()) {
    haystacks.add(conversation.description.trim().toLowerCase());
  }

  for (const member of conversation.members) {
    if (member.displayName) haystacks.add(member.displayName.toLowerCase());
    if (member.username) haystacks.add(member.username.toLowerCase());
  }

  if (conversation.lastMessage) {
    haystacks.add(getMessagePreviewText(conversation.lastMessage).toLowerCase());
  }

  if (currentUserId && conversation.type === 'direct') {
    const peer = getDirectPeer(conversation, currentUserId);
    if (peer?.displayName) haystacks.add(peer.displayName.toLowerCase());
    if (peer?.username) haystacks.add(peer.username.toLowerCase());
  }

  return [...haystacks].some((value) => value.includes(q));
}

export function filterConversationsBySearch(
  conversations: Conversation[],
  query: string,
  currentUserId?: string,
): Conversation[] {
  if (!isSearchQueryActive(query)) return conversations;
  return conversations.filter((conversation) =>
    conversationMatchesSearch(conversation, query, currentUserId),
  );
}

export function getConversationSearchSubtitle(
  conversation: Conversation,
  currentUserId?: string,
): string {
  if (conversation.type === 'channel') return 'Channel';
  if (conversation.type === 'group') return 'Group';
  const peer = currentUserId ? getDirectPeer(conversation, currentUserId) : undefined;
  if (peer?.username) return `@${peer.username}`;
  return getConversationMentionLabel(conversation, currentUserId);
}
