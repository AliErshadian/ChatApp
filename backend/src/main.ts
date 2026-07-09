import { NestFactory } from '@nestjs/core';
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

async function bootstrap() {
  initSentry();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.use(new RequestIdMiddleware().use);
  app.use(createHttpLogger());
  app.useGlobalFilters(new SentryExceptionFilter());

  await setupRedisAdapter(app);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const corsAllowlist = parseCorsOriginList(config.get<string>('CORS_ORIGIN')!);
  app.enableCors({
    origin: (origin, callback) => {
      callback(null, isOriginAllowed(origin, corsAllowlist));
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
  // eslint-disable-next-line no-console
  console.log(`Chat API listening on http://0.0.0.0:${port}`);
}

bootstrap();
