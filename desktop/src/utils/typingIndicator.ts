export function formatTypingIndicator(
  userIds: string[],
  members: Array<{ userId: string; displayName?: string; username?: string }>,
): string | null {
  if (userIds.length === 0) return null;

  const names = userIds.map((id) => {
    const member = members.find((m) => m.userId === id);
    return member?.displayName ?? member?.username ?? 'Someone';
  });

  if (names.length === 1) return `${names[0]} is typing...`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
  return `${names[0]} and ${names.length - 1} others are typing...`;
}
