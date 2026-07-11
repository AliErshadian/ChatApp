import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.constants';
import { Inject } from '@nestjs/common';
import {
  RealtimeEventEnvelope,
  RealtimeTarget,
  realtimeTargetChannel,
} from './realtime.types';

type ChannelHandler = (envelope: RealtimeEventEnvelope) => void;

@Injectable()
export class RealtimeEventBusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeEventBusService.name);
  private readonly channelHandlers = new Map<string, Set<ChannelHandler>>();
  private readonly subscriber: Redis;
  private redisAvailable = true;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    this.subscriber = this.redis.duplicate();
  }

  async onModuleInit() {
    this.subscriber.on('message', (channel, payload) => {
      this.dispatch(channel, payload);
    });
    this.subscriber.on('error', () => {
      this.redisAvailable = false;
    });
  }

  async onModuleDestroy() {
    try {
      await this.subscriber.quit();
    } catch {
      this.subscriber.disconnect();
    }
  }

  async publish(target: RealtimeTarget, envelope: RealtimeEventEnvelope): Promise<void> {
    const channel = realtimeTargetChannel(target);
    const payload = JSON.stringify(envelope);

    if (!this.redisAvailable) {
      this.deliver(channel, envelope);
      return;
    }

    try {
      await this.redis.publish(channel, payload);
    } catch (error) {
      this.redisAvailable = false;
      this.logger.warn(`Redis publish failed; using in-process delivery only (${String(error)})`);
      this.deliver(channel, envelope);
    }
  }

  async subscribe(
    channels: string[],
    handler: ChannelHandler,
  ): Promise<() => Promise<void>> {
    const uniqueChannels = [...new Set(channels.filter(Boolean))];

    for (const channel of uniqueChannels) {
      let handlers = this.channelHandlers.get(channel);
      if (!handlers) {
        handlers = new Set();
        this.channelHandlers.set(channel, handlers);
        if (this.redisAvailable) {
          try {
            await this.subscriber.subscribe(channel);
          } catch (error) {
            this.redisAvailable = false;
            this.logger.warn(`Redis subscribe failed (${String(error)})`);
          }
        }
      }
      handlers.add(handler);
    }

    return async () => {
      for (const channel of uniqueChannels) {
        const handlers = this.channelHandlers.get(channel);
        if (!handlers) continue;
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.channelHandlers.delete(channel);
          if (this.redisAvailable) {
            try {
              await this.subscriber.unsubscribe(channel);
            } catch {
              // ignore unsubscribe errors during cleanup
            }
          }
        }
      }
    };
  }

  private dispatch(channel: string, payload: string) {
    try {
      const envelope = JSON.parse(payload) as RealtimeEventEnvelope;
      this.deliver(channel, envelope);
    } catch (error) {
      this.logger.warn(`Ignored invalid realtime bus payload on ${channel}: ${String(error)}`);
    }
  }

  private deliver(channel: string, envelope: RealtimeEventEnvelope) {
    const handlers = this.channelHandlers.get(channel);
    if (!handlers || handlers.size === 0) return;
    for (const handler of handlers) {
      handler(envelope);
    }
  }
}
