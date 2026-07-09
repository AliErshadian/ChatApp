import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { ServerOptions } from 'socket.io';
import { isOriginAllowed, parseCorsOriginList } from '../../config/cors';

class ConfiguredIoAdapter extends IoAdapter {
  constructor(
    app: INestApplication,
    private readonly config: ConfigService,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const allowlist = parseCorsOriginList(this.config.get<string>('CORS_ORIGIN')!);
    const allowPrivateNetwork = this.config.get<string>('NODE_ENV') !== 'production';
    const merged = {
      ...options,
      // Socket.IO types require `path` to be a string
      path: options?.path ?? '/socket.io',
      // Socket.IO types require `serveClient` to be a boolean
      serveClient: options?.serveClient ?? false,
      cors: {
        // Let gateway-level metadata override if explicitly set,
        // otherwise fall back to environment-driven allowlist.
        origin: (origin: string | undefined, callback: (err: Error | null, allowed?: boolean) => void) => {
          callback(null, isOriginAllowed(origin, allowlist, { allowPrivateNetwork }));
        },
        credentials: true,
        ...(options?.cors as object),
      },
    };
    // Cast is intentional: Socket.IO's `ServerOptions` type differs across versions
    // and may mark some options as required even when runtime defaults exist.
    return super.createIOServer(port, merged as unknown as ServerOptions);
  }
}

export class RedisIoAdapter extends ConfiguredIoAdapter {
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
    const redisAdapter = new RedisIoAdapter(app, config);
    await redisAdapter.connectToRedis(config);
    app.useWebSocketAdapter(redisAdapter);
    console.log(`Socket.IO Redis adapter connected (${redisUrl})`);
  } catch (_err) {
    // Still set an adapter so Socket.IO CORS is configured via env.
    app.useWebSocketAdapter(new ConfiguredIoAdapter(app, config));
    console.warn(
      'Redis unavailable — using in-memory Socket.IO adapter (fine for local dev).',
    );
    console.warn(`REDIS_URL=${redisUrl}`);
  }
}
