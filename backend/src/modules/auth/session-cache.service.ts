import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  REDIS_CLIENT,
  SESSION_REVOKED_KEY,
  SESSION_REVOKED_TTL_SECONDS,
  SESSION_TOUCH_DEBOUNCE_SECONDS,
  SESSION_TOUCH_KEY,
  SESSION_VALID_KEY,
} from '../../infrastructure/redis/redis.constants';

@Injectable()
export class SessionCacheService {
  private readonly validTtlSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
  ) {
    const accessExpiresIn = config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m');
    this.validTtlSeconds = this.parseExpirySeconds(accessExpiresIn);
  }

  async getCachedUserId(sessionId: string): Promise<string | null | 'revoked'> {
    return this.safe(async () => {
      const [revoked, userId] = await this.redis.mget(
        SESSION_REVOKED_KEY(sessionId),
        SESSION_VALID_KEY(sessionId),
      );

      if (revoked) return 'revoked';
      if (userId) return userId;
      return null;
    }, null);
  }

  async cacheValidSession(sessionId: string, userId: string): Promise<void> {
    await this.safe(async () => {
      const pipeline = this.redis.pipeline();
      pipeline.set(SESSION_VALID_KEY(sessionId), userId, 'EX', this.validTtlSeconds);
      pipeline.del(SESSION_REVOKED_KEY(sessionId));
      await pipeline.exec();
    }, undefined);
  }

  async markSessionRevoked(sessionId: string): Promise<void> {
    await this.safe(async () => {
      const pipeline = this.redis.pipeline();
      pipeline.del(SESSION_VALID_KEY(sessionId));
      pipeline.del(SESSION_TOUCH_KEY(sessionId));
      pipeline.set(SESSION_REVOKED_KEY(sessionId), '1', 'EX', SESSION_REVOKED_TTL_SECONDS);
      await pipeline.exec();
    }, undefined);
  }

  async shouldTouchSession(sessionId: string): Promise<boolean> {
    return this.safe(async () => {
      const result = await this.redis.set(
        SESSION_TOUCH_KEY(sessionId),
        '1',
        'EX',
        SESSION_TOUCH_DEBOUNCE_SECONDS,
        'NX',
      );
      return result === 'OK';
    }, true);
  }

  private async safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  }

  private parseExpirySeconds(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 900;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * (multipliers[unit] ?? 60);
  }
}
