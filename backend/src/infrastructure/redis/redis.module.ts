import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL', 'redis://localhost:6379');
        const redis = new Redis(url, {
          maxRetriesPerRequest: 3,
          lazyConnect: true,
          retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
        });
        redis.on('error', () => {
          // Swallow connection errors — presence degrades gracefully without Redis
        });
        return redis;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
