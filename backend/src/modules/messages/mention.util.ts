export const MENTION_USERNAME_PATTERN = /[a-zA-Z0-9_]{3,64}/;

const MENTION_TOKEN_REGEX = new RegExp(`@(${MENTION_USERNAME_PATTERN.source})`, 'g');

export function extractMentionUsernames(content: string): string[] {
  const usernames = new Set<string>();
  for (const match of content.matchAll(MENTION_TOKEN_REGEX)) {
    usernames.add(match[1].toLowerCase());
  }
  return [...usernames];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface MentionMember {
  userId: string;
  username: string;
  displayName?: string;
}

export function resolveMentionUserIds(
  content: string,
  members: MentionMember[],
): string[] {
  const userIds = new Set<string>();
  if (!content) return [];

  const byUsername = new Map(
    members.map((member) => [member.username.toLowerCase(), member.userId]),
  );

  for (const token of extractMentionUsernames(content)) {
    const userId = byUsername.get(token);
    if (userId) userIds.add(userId);
  }

  for (const member of members) {
    const displayName = member.displayName?.trim();
    if (!displayName || /\s/.test(displayName)) continue;
    const pattern = new RegExp(`@${escapeRegExp(displayName)}(?=\\s|$|[.,!?;:])`, 'i');
    if (pattern.test(content)) {
      userIds.add(member.userId);
    }
  }

  return [...userIds];
}
