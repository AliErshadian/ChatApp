import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { captureException } from './sentry';

@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  constructor(adapterHost: HttpAdapterHost) {
    super(adapterHost.httpAdapter);
  }

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
    } else {
      captureException(exception, { type });
    }

    super.catch(exception, host);
  }
}
