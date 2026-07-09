export interface MessageMention {
  userId: string;
  username: string;
  displayName: string;
}

export function detectActiveMentionQuery(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const match = /(?:^|\s)@([a-zA-Z0-9_]*)$/.exec(before);
  if (!match) return null;

  return {
    start: caret - match[1].length - 1,
    query: match[1],
  };
}

export function filterMentionCandidates(
  members: Array<{
    userId: string;
    username?: string;
    displayName?: string;
  }>,
  currentUserId: string,
  query: string,
) {
  const normalized = query.trim().toLowerCase();

  return members
    .filter((member) => member.userId !== currentUserId)
    .filter((member) => {
      if (!normalized) return true;
      const username = member.username?.toLowerCase() ?? '';
      const displayName = member.displayName?.toLowerCase() ?? '';
      return username.startsWith(normalized) || displayName.startsWith(normalized);
    })
    .slice(0, 8);
}

export function insertMention(
  value: string,
  caret: number,
  mentionStart: number,
  member: { username: string; displayName?: string },
) {
  const before = value.slice(0, mentionStart);
  const after = value.slice(caret);
  const token =
    member.displayName && !/\s/.test(member.displayName) ? member.displayName : member.username;
  const mention = `@${token} `;
  const nextValue = `${before}${mention}${after}`;
  const nextCaret = before.length + mention.length;
  return { value: nextValue, caret: nextCaret };
}
