export function formatAuthError(error: unknown): string {
  if (error instanceof Error) {
    const status = (error as Error & { status?: number }).status;
    const raw = error.message.trim();

    if (status === 401) return 'Invalid email or password.';
    if (status === 403) return 'This account does not have admin access.';
    if (status === 429 || /too many/i.test(raw)) {
      return 'Too many attempts. Please wait and try again.';
    }
    if (raw.startsWith('Cannot reach server') || /timed out/i.test(raw)) return raw;
    return raw || 'Request failed.';
  }
  return 'Something went wrong. Please try again.';
}

export function extractApiErrorMessage(body: unknown, status: number): string {
  if (!body || typeof body !== 'object') return `Request failed (${status})`;
  const record = body as Record<string, unknown>;
  const message = record.message;
  if (typeof message === 'string' && message.trim()) return message.trim();
  if (Array.isArray(message)) {
    const parts = message.filter((p): p is string => typeof p === 'string');
    if (parts.length) return parts.join(' ');
  }
  return `Request failed (${status})`;
}

export function isSessionAuthFailure(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return normalized === 'session terminated' || normalized === 'session required';
}
