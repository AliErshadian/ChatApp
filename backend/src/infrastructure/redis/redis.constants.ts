export const REDIS_CLIENT = 'REDIS_CLIENT';

export const PRESENCE_KEY = (userId: string) => `presence:${userId}`;
export const TYPING_KEY = (conversationId: string) => `typing:${conversationId}`;
export const PRESENCE_TTL_SECONDS = 90;

export const REALTIME_USER_CHANNEL = (userId: string) => `rt:user:${userId}`;
export const REALTIME_SESSION_CHANNEL = (sessionId: string) => `rt:session:${sessionId}`;
export const REALTIME_CONVERSATION_CHANNEL = (conversationId: string) =>
  `rt:conversation:${conversationId}`;
export const REALTIME_GLOBAL_CHANNEL = 'rt:global';

export const SESSION_VALID_KEY = (sessionId: string) => `session:valid:${sessionId}`;
export const SESSION_REVOKED_KEY = (sessionId: string) => `session:revoked:${sessionId}`;
export const SESSION_TOUCH_KEY = (sessionId: string) => `session:touch:${sessionId}`;
export const SESSION_REVOKED_TTL_SECONDS = 60;
export const SESSION_TOUCH_DEBOUNCE_SECONDS = 60;
