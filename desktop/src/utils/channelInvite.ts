export const APP_INVITE_SCHEME = 'chatapp';
export const APP_INVITE_PREFIX = `${APP_INVITE_SCHEME}://invite/`;

export function buildChannelInviteLink(token: string): string {
  return `${APP_INVITE_PREFIX}${token}`;
}

export function parseInviteTokenFromLink(link: string): string | null {
  const trimmed = link.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== `${APP_INVITE_SCHEME}:`) return null;

    if (url.hostname === 'invite') {
      const token = url.pathname.replace(/^\//, '');
      return token || null;
    }

    if (url.pathname.startsWith('/invite/')) {
      const token = url.pathname.slice('/invite/'.length);
      return token || null;
    }
  } catch {
    // Fall through to regex.
  }

  const match = trimmed.match(/^chatapp:\/\/invite\/([A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}

export function stashPendingInviteToken(token: string) {
  sessionStorage.setItem('pendingInviteToken', token);
  window.dispatchEvent(new CustomEvent('chatapp:invite', { detail: { token } }));
}

export function takePendingInviteToken(): string | null {
  const token = sessionStorage.getItem('pendingInviteToken');
  if (token) sessionStorage.removeItem('pendingInviteToken');
  return token;
}
