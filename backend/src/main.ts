import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { setupRedisAdapter } from './infrastructure/websocket/redis-io.adapter';
import { RequestIdMiddleware } from './observability/request-id.middleware';
import { createHttpLogger } from './observability/logging';
import { initSentry } from './observability/sentry';
import { SentryExceptionFilter } from './observability/sentry-exception.filter';
import { isOriginAllowed, parseCorsOriginList } from './config/cors';
import { API_CSP_DIRECTIVES } from './config/csp';

async function bootstrap() {
  initSentry();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.use(new RequestIdMiddleware().use);
  app.use(createHttpLogger());
  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new SentryExceptionFilter(httpAdapterHost));

  await setupRedisAdapter(app);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        useDefaults: false,
        directives: API_CSP_DIRECTIVES,
      },
      // SPA clients load cross-origin API media via fetch; keep COEP off
      crossOriginEmbedderPolicy: false,
    }),
  );

  const corsAllowlist = parseCorsOriginList(config.get<string>('CORS_ORIGIN')!);
  const allowPrivateNetwork = config.get<string>('NODE_ENV') !== 'production';
  app.enableCors({
    origin: (origin, callback) => {
      callback(null, isOriginAllowed(origin, corsAllowlist, { allowPrivateNetwork }));
    },
    credentials: true,
  });
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api/v1');

  const port = config.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');
  // Keep a plain startup line; request-level logs are structured.
  console.log(`Chat API listening on http://0.0.0.0:${port}`);
}

bootstrap();
