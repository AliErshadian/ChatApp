export const REDIS_CLIENT = 'REDIS_CLIENT';

export const PRESENCE_KEY = (userId: string) => `presence:${userId}`;
export const TYPING_KEY = (conversationId: string) => `typing:${conversationId}`;
export const PRESENCE_TTL_SECONDS = 90;
