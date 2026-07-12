import { randomUUID } from 'crypto';

export function buildObjectKey(extension: string, prefix = 'chat'): string {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const normalizedExt = extension.startsWith('.') ? extension : `.${extension}`;
  return `${prefix}/${year}/${month}/${day}/${randomUUID()}${normalizedExt}`;
}

export function buildStoredFileName(extension: string): string {
  const normalizedExt = extension.startsWith('.') ? extension : `.${extension}`;
  return `${randomUUID()}${normalizedExt}`;
}
