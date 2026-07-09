export function parseCorsOriginList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed === '*') return ['*'];
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isOriginAllowed(
  origin: string | undefined,
  allowlist: string[],
): boolean {
  // Allow non-browser clients / same-origin where Origin header may be absent.
  if (!origin) return true;
  if (allowlist.includes('*')) return true;
  return allowlist.includes(origin);
}

