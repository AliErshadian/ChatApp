export function parseCorsOriginList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed === '*') return ['*'];
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isPrivateNetworkHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
  if (hostname.endsWith('.local')) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return false;
}

export function isPrivateNetworkOrigin(origin: string): boolean {
  try {
    return isPrivateNetworkHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export interface OriginAllowOptions {
  allowPrivateNetwork?: boolean;
}

export function isOriginAllowed(
  origin: string | undefined,
  allowlist: string[],
  options: OriginAllowOptions = {},
): boolean {
  // Allow non-browser clients / same-origin where Origin header may be absent.
  if (!origin) return true;
  if (allowlist.includes('*')) return true;
  if (allowlist.includes(origin)) return true;
  if (options.allowPrivateNetwork && isPrivateNetworkOrigin(origin)) return true;
  return false;
}
