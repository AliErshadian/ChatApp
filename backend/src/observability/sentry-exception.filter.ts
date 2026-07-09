import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { captureException } from './sentry';

@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const type = host.getType<'http' | 'ws' | 'rpc'>();

    if (type === 'http') {
      const ctx = host.switchToHttp();
      const req = ctx.getRequest<{ method?: string; url?: string; requestId?: string }>();
      const status =
        exception instanceof HttpException ? exception.getStatus() : 500;

      captureException(exception, {
        type,
        status,
        method: req?.method,
        url: req?.url,
        requestId: req?.requestId,
      });
      return;
    }

    captureException(exception, { type });
  }
}

