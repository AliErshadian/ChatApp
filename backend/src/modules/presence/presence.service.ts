import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT, PRESENCE_KEY, TYPING_KEY, PRESENCE_TTL_SECONDS } from '../../infrastructure/redis/redis.constants';
import { PresenceConnectionRegistry } from './presence-connection.registry';

export type PresenceStatus = 'online' | 'away' | 'offline';

export interface PresenceInfo {
  userId: string;
  status: PresenceStatus;
  lastSeen: string;
}

@Injectable()
export class PresenceService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly connections: PresenceConnectionRegistry,
  ) {}

  private async safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  }

  async setOnline(userId: string, socketId: string) {
    await this.safe(async () => {
      const key = PRESENCE_KEY(userId);
      await this.redis
        .multi()
        .hset(key, { status: 'online', socketId, lastSeen: new Date().toISOString() })
        .expire(key, PRESENCE_TTL_SECONDS)
        .exec();
    }, undefined);
  }

  async setOffline(userId: string) {
    await this.safe(async () => {
      const key = PRESENCE_KEY(userId);
      await this.redis.hset(key, {
        status: 'offline',
        lastSeen: new Date().toISOString(),
      });
      await this.redis.expire(key, PRESENCE_TTL_SECONDS * 10);
    }, undefined);
  }

  async heartbeat(userId: string) {
    await this.safe(async () => {
      const key = PRESENCE_KEY(userId);
      const exists = await this.redis.exists(key);
      if (exists) {
        await this.redis.expire(key, PRESENCE_TTL_SECONDS);
        await this.redis.hset(key, 'lastSeen', new Date().toISOString());
      }
    }, undefined);
  }

  async getPresence(userIds: string[]): Promise<PresenceInfo[]> {
    if (userIds.length === 0) return [];

    const redisPresence = await this.safe(async () => {
      const pipeline = this.redis.pipeline();
      userIds.forEach((id) => pipeline.hgetall(PRESENCE_KEY(id)));
      const results = await pipeline.exec();

      return userIds.map((userId, i) => {
        const data = (results?.[i]?.[1] as Record<string, string>) ?? {};
        return {
          userId,
          status: (data.status as PresenceStatus) ?? 'offline',
          lastSeen: data.lastSeen ?? new Date(0).toISOString(),
        };
      });
    }, userIds.map((userId) => ({
      userId,
      status: 'offline' as PresenceStatus,
      lastSeen: new Date(0).toISOString(),
    })));

    return redisPresence.map((entry) => {
      if (this.connections.isOnline(entry.userId)) {
        return {
          ...entry,
          status: 'online' as PresenceStatus,
          lastSeen: new Date().toISOString(),
        };
      }
      return entry;
    });
  }

  async setTyping(conversationId: string, userId: string, isTyping: boolean) {
    await this.safe(async () => {
      const key = TYPING_KEY(conversationId);
      if (isTyping) {
        await this.redis.setex(`${key}:${userId}`, 5, '1');
      } else {
        await this.redis.del(`${key}:${userId}`);
      }
    }, undefined);
  }

  async getTypingUsers(conversationId: string): Promise<string[]> {
    return this.safe(async () => {
      const pattern = `${TYPING_KEY(conversationId)}:*`;
      const keys = await this.redis.keys(pattern);
      return keys.map((k) => k.split(':').pop()!);
    }, []);
  }
}
