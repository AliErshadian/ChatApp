export function createClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // randomUUID needs a secure context (HTTPS); fall back on LAN HTTP.
    }
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
