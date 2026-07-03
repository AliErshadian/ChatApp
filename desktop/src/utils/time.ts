export function formatRelativeTime(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 60_000) return 'now';

  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 6);
  if (date >= weekAgo) {
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  }

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatClockTime(date: Date) {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatLastSeen(iso?: string) {
  if (!iso) return 'Last seen recently';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) {
    return 'Last seen recently';
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 60_000) return 'Last seen just now';

  const time = formatClockTime(date);

  if (date.toDateString() === now.toDateString()) {
    return `Last seen today at ${time}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Last seen yesterday at ${time}`;
  }

  if (date.getFullYear() === now.getFullYear()) {
    const day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `Last seen ${day} at ${time}`;
  }

  const day = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `Last seen ${day} at ${time}`;
}
