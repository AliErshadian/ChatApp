import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.constants';
import { LOGIN_FAIL_ID_KEY, LOGIN_FAIL_IP_KEY } from './login-protection.constants';

@Injectable()
export class LoginAttemptService {
  private readonly logger = new Logger(LoginAttemptService.name);
  private readonly threshold: number;
  private readonly windowSeconds: number;
  private readonly memory = new Map<string, { count: number; expiresAt: number }>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.threshold = Math.max(
      1,
      Number(config.get<string>('LOGIN_FAIL_CAPTCHA_THRESHOLD') ?? 3),
    );
    this.windowSeconds = Math.max(
      60,
      Number(config.get<string>('LOGIN_FAIL_WINDOW_SECONDS') ?? 900),
    );
  }

  getThreshold(): number {
    return this.threshold;
  }

  async isCaptchaRequired(ipAddress: string | undefined, identifier?: string): Promise<boolean> {
    const checks: Promise<number>[] = [
      this.getCount(LOGIN_FAIL_IP_KEY(this.normalizeIp(ipAddress))),
    ];
    if (identifier?.trim()) {
      checks.push(this.getCount(LOGIN_FAIL_ID_KEY(this.normalizeId(identifier))));
    }
    const counts = await Promise.all(checks);
    return counts.some((count) => count >= this.threshold);
  }

  async recordFailure(ipAddress: string | undefined, identifier: string): Promise<{
    captchaRequired: boolean;
    attempts: number;
  }> {
    const ipKey = LOGIN_FAIL_IP_KEY(this.normalizeIp(ipAddress));
    const idKey = LOGIN_FAIL_ID_KEY(this.normalizeId(identifier));
    const [ipCount, idCount] = await Promise.all([
      this.increment(ipKey),
      this.increment(idKey),
    ]);
    const attempts = Math.max(ipCount, idCount);
    return {
      attempts,
      captchaRequired: attempts >= this.threshold,
    };
  }

  async clearFailures(ipAddress: string | undefined, identifier: string): Promise<void> {
    await Promise.all([
      this.del(LOGIN_FAIL_IP_KEY(this.normalizeIp(ipAddress))),
      this.del(LOGIN_FAIL_ID_KEY(this.normalizeId(identifier))),
    ]);
  }

  private normalizeIp(ip?: string): string {
    const value = (ip || 'unknown').trim().toLowerCase();
    return value || 'unknown';
  }

  private normalizeId(identifier: string): string {
    return identifier.trim().toLowerCase() || 'unknown';
  }

  private async getCount(key: string): Promise<number> {
    return this.safe(async () => {
      await this.redis.connect().catch(() => undefined);
      const raw = await this.redis.get(key);
      return raw ? Number(raw) || 0 : 0;
    }, () => this.memoryGet(key));
  }

  private async increment(key: string): Promise<number> {
    return this.safe(async () => {
      await this.redis.connect().catch(() => undefined);
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, this.windowSeconds);
      }
      return count;
    }, () => this.memoryIncr(key));
  }

  private async del(key: string): Promise<void> {
    this.memory.delete(key);
    await this.safe(async () => {
      await this.redis.connect().catch(() => undefined);
      await this.redis.del(key);
    }, undefined);
  }

  private memoryGet(key: string): number {
    const entry = this.memory.get(key);
    if (!entry) return 0;
    if (entry.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return 0;
    }
    return entry.count;
  }

  private memoryIncr(key: string): number {
    const now = Date.now();
    const prev = this.memory.get(key);
    if (!prev || prev.expiresAt <= now) {
      const next = { count: 1, expiresAt: now + this.windowSeconds * 1000 };
      this.memory.set(key, next);
      return 1;
    }
    prev.count += 1;
    this.memory.set(key, prev);
    return prev.count;
  }

  private async safe<T>(fn: () => Promise<T>, fallback: T | (() => T)): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.logger.debug(
        `Login attempt store fallback: ${err instanceof Error ? err.message : err}`,
      );
      return typeof fallback === 'function' ? (fallback as () => T)() : fallback;
    }
  }
}
