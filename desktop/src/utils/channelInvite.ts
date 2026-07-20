export const APP_INVITE_SCHEME = 'relay';
export const APP_INVITE_PREFIX = `${APP_INVITE_SCHEME}://invite/`;

export function buildChannelInviteLink(token: string): string {
  return `${APP_INVITE_PREFIX}${token}`;
}

export function parseInviteTokenFromLink(link: string): string | null {
  const trimmed = link.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const scheme = url.protocol.replace(/:$/, '').toLowerCase();
    if (scheme !== APP_INVITE_SCHEME && scheme !== 'chatapp') return null;

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

  const match = trimmed.match(/^(?:relay|chatapp):\/\/invite\/([A-Za-z0-9_-]+)$/i);
  return match?.[1] ?? null;
}

export function stashPendingInviteToken(token: string) {
  sessionStorage.setItem('pendingInviteToken', token);
  window.dispatchEvent(new CustomEvent('relay:invite', { detail: { token } }));
}

export function takePendingInviteToken(): string | null {
  const token = sessionStorage.getItem('pendingInviteToken');
  if (token) sessionStorage.removeItem('pendingInviteToken');
  return token;
}
