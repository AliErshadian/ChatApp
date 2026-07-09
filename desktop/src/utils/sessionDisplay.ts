import type { ActiveSession } from '../services/api';
import { formatRelativeTime } from './time';

export function sessionIcon(session: ActiveSession): string {
  if (session.appName === 'ChatApp') return '💻';
  if (session.platform?.match(/iOS|Android/i)) return '📱';
  return '🌐';
}

export function sessionStatusLabel(session: ActiveSession, isCurrent: boolean): string {
  if (isCurrent) return 'Online';
  return `Last active ${formatRelativeTime(session.lastActiveAt)}`;
}

export function buildNewSessionNotificationText(
  deviceLabel: string,
  ipAddress?: string | null,
): string {
  const ip = ipAddress ? ` · ${ipAddress}` : '';
  return `New login from ${deviceLabel}${ip}`;
}
