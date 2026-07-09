export interface JwtPayload {
  sub?: string;
  email?: string;
  sid?: string;
  exp?: number;
}

export function decodeJwtPayload(token: string | null | undefined): JwtPayload | null {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length < 2) return null;

  try {
    return JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as JwtPayload;
  } catch {
    return null;
  }
}

export function getSessionIdFromToken(token: string | null | undefined): string | null {
  const sid = decodeJwtPayload(token)?.sid;
  return typeof sid === 'string' && sid.length > 0 ? sid : null;
}

export function isAccessTokenUsable(token: string | null | undefined, skewSeconds = 30): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return false;

  if (typeof payload.exp !== 'number') return true;
  return payload.exp * 1000 > Date.now() + skewSeconds * 1000;
}
