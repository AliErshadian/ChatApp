export interface RealtimeEventEnvelope {
  event: string;
  data: unknown;
  excludeSessionId?: string;
}

export type RealtimeTarget =
  | { scope: 'user'; userId: string; exceptSessionId?: string }
  | { scope: 'session'; sessionId: string }
  | { scope: 'conversation'; conversationId: string }
  | { scope: 'global' };

export function realtimeTargetChannel(target: RealtimeTarget): string {
  switch (target.scope) {
    case 'user':
      return `rt:user:${target.userId}`;
    case 'session':
      return `rt:session:${target.sessionId}`;
    case 'conversation':
      return `rt:conversation:${target.conversationId}`;
    case 'global':
      return 'rt:global';
  }
}
