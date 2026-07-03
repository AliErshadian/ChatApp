import { parseInviteTokenFromLink, stashPendingInviteToken } from './channelInvite';

const LINK_PATTERN =
  /(https?:\/\/[^\s<]+[^\s<.,;:!?'")\]}>]|chatapp:\/\/invite\/[A-Za-z0-9_-]+)/gi;

function trimTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?)]+$/, '');
}

export function openMessageLink(href: string) {
  const inviteToken = parseInviteTokenFromLink(href);
  if (inviteToken) {
    stashPendingInviteToken(inviteToken);
    return;
  }

  if (href.startsWith('http://') || href.startsWith('https://')) {
    if (window.electronAPI?.openExternal) {
      void window.electronAPI.openExternal(href);
      return;
    }
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}

export function splitMessageLinks(text: string): Array<{ type: 'text' | 'link'; value: string }> {
  const parts: Array<{ type: 'text' | 'link'; value: string }> = [];
  let lastIndex = 0;

  for (const match of text.matchAll(LINK_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, index) });
    }

    const raw = match[0];
    const href = trimTrailingPunctuation(raw);
    parts.push({ type: 'link', value: href });

    const trailing = raw.slice(href.length);
    if (trailing) {
      parts.push({ type: 'text', value: trailing });
    }

    lastIndex = index + raw.length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: 'text', value: text }];
}
