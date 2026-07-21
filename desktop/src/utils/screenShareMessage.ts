import type { Message } from '../services/api';

export const SCREEN_SHARE_CONTENT_TYPE = 'application/vnd.relay.screen-share+json';

export interface ScreenShareMessagePayload {
  sessionId: string;
  status: 'active' | 'ended';
  presenterId: string;
  presenterName: string;
  endedAt?: string;
}

export function isScreenShareMessage(message: Pick<Message, 'contentType'>): boolean {
  return message.contentType === SCREEN_SHARE_CONTENT_TYPE;
}

export function parseScreenShareMessage(
  message: Pick<Message, 'content' | 'contentType'>,
): ScreenShareMessagePayload | null {
  if (!isScreenShareMessage(message)) return null;
  try {
    const parsed = JSON.parse(message.content) as Partial<ScreenShareMessagePayload>;
    if (!parsed.sessionId || !parsed.presenterId) return null;
    return {
      sessionId: parsed.sessionId,
      status: parsed.status === 'ended' ? 'ended' : 'active',
      presenterId: parsed.presenterId,
      presenterName: parsed.presenterName?.trim() || 'Someone',
      endedAt: parsed.endedAt,
    };
  } catch {
    return null;
  }
}
