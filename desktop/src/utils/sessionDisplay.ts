import type { ActiveSession } from '../services/api';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faDesktop, faGlobe, faMobileScreen } from '@fortawesome/free-solid-svg-icons';
import { formatRelativeTime } from './time';

export function sessionIcon(session: ActiveSession): IconDefinition {
  if (session.appName === 'ChatApp') return faDesktop;
  if (session.platform?.match(/iOS|Android/i)) return faMobileScreen;
  return faGlobe;
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
