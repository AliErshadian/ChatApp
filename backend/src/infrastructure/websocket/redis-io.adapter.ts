import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor!: ReturnType<typeof createAdapter>;

  async connectToRedis(config: ConfigService): Promise<void> {
    const redisUrl = config.get<string>('REDIS_URL', 'redis://localhost:6379');
    const pubClient = createClient({ url: redisUrl });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }
}

export async function setupRedisAdapter(
  app: INestApplication,
): Promise<void> {
  const config = app.get(ConfigService);
  const redisUrl = config.get<string>('REDIS_URL', 'redis://localhost:6379');

  try {
    const redisAdapter = new RedisIoAdapter(app);
    await redisAdapter.connectToRedis(config);
    app.useWebSocketAdapter(redisAdapter);
    console.log(`Socket.IO Redis adapter connected (${redisUrl})`);
  } catch (err) {
    console.warn(
      'Redis unavailable — using in-memory Socket.IO adapter (fine for local dev).',
    );
    console.warn(`REDIS_URL=${redisUrl}`);
  }
}
