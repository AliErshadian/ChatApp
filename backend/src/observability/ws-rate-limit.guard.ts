import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { WsException } from '@nestjs/websockets';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../infrastructure/redis/redis.constants';
import { WS_RATE_LIMIT_META, WsRateLimitOptions } from './ws-rate-limit.decorator';

const LUA_TOKEN_BUCKET = `
-- KEYS[1] = key
-- ARGV[1] = now_ms
-- ARGV[2] = capacity
-- ARGV[3] = refill_per_sec
-- ARGV[4] = ttl_seconds

local key = KEYS[1]
local now = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refillPerSec = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil then tokens = capacity end
if ts == nil then ts = now end

local deltaMs = now - ts
if deltaMs < 0 then deltaMs = 0 end

local refill = (deltaMs / 1000.0) * refillPerSec
tokens = math.min(capacity, tokens + refill)

local allowed = 0
if tokens >= 1.0 then
  allowed = 1
  tokens = tokens - 1.0
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', key, ttl)

return { allowed, tokens }
`;

type BucketState = { tokens: number; ts: number };

@Injectable()
export class WsRateLimitGuard implements CanActivate {
  private readonly localBuckets = new Map<string, BucketState>();

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private resolveOptions(options: WsRateLimitOptions): WsRateLimitOptions {
    // Allow overriding specific actions from env.
    // Fallback to the decorator defaults.
    if (options.action === 'message_send') {
      return {
        ...options,
        capacity: this.config.get<number>(
          'WS_RATE_LIMIT_MESSAGE_SEND_CAPACITY',
          options.capacity,
        ),
        refillPerSec: this.config.get<number>(
          'WS_RATE_LIMIT_MESSAGE_SEND_REFILL_PER_SEC',
          options.refillPerSec,
        ),
      };
    }
    if (options.action === 'typing') {
      return {
        ...options,
        capacity: this.config.get<number>('WS_RATE_LIMIT_TYPING_CAPACITY', options.capacity),
        refillPerSec: this.config.get<number>(
          'WS_RATE_LIMIT_TYPING_REFILL_PER_SEC',
          options.refillPerSec,
        ),
      };
    }
    return options;
  }

  private buildKey(userId: string, options: WsRateLimitOptions, body: any) {
    const suffix = options.keySuffixFromBody?.(body);
    const tail = suffix ? `:${suffix}` : '';
    return `wsrl:${options.action}:${userId}${tail}`;
  }

  private async allowWithRedis(
    key: string,
    options: WsRateLimitOptions,
    nowMs: number,
  ): Promise<boolean> {
    // TTL is long enough to survive idle periods but still clean up.
    const ttlSeconds = Math.max(10, Math.ceil(options.capacity / Math.max(0.001, options.refillPerSec)));
    const result = (await this.redis.eval(LUA_TOKEN_BUCKET, 1, key, nowMs, options.capacity, options.refillPerSec, ttlSeconds)) as [
      number,
      number,
    ];
    return result?.[0] === 1;
  }

  private allowWithMemory(
    key: string,
    options: WsRateLimitOptions,
    nowMs: number,
  ): boolean {
    const prev = this.localBuckets.get(key);
    const capacity = options.capacity;
    const refillPerSec = options.refillPerSec;
    if (!prev) {
      this.localBuckets.set(key, { tokens: capacity - 1, ts: nowMs });
      return true;
    }

    const deltaMs = Math.max(0, nowMs - prev.ts);
    const refill = (deltaMs / 1000) * refillPerSec;
    const tokens = Math.min(capacity, prev.tokens + refill);
    const allowed = tokens >= 1;
    this.localBuckets.set(key, { tokens: allowed ? tokens - 1 : tokens, ts: nowMs });
    return allowed;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rawOptions = this.reflector.get<WsRateLimitOptions | undefined>(
      WS_RATE_LIMIT_META,
      context.getHandler(),
    );
    if (!rawOptions) return true;
    const options = this.resolveOptions(rawOptions);

    const ws = context.switchToWs();
    const client = ws.getClient<{ data?: { userId?: string } }>();
    const body = ws.getData<any>();
    const userId = client?.data?.userId;
    if (!userId) return true;

    const key = this.buildKey(userId, options, body);
    const nowMs = Date.now();

    let allowed: boolean;
    try {
      // Lazy-connect; if Redis is unavailable, fall back to in-memory.
      await this.redis.connect().catch(() => undefined);
      allowed = await this.allowWithRedis(key, options, nowMs);
    } catch {
      allowed = this.allowWithMemory(key, options, nowMs);
    }

    if (!allowed) {
      throw new WsException('Rate limit exceeded');
    }
    return true;
  }
}

