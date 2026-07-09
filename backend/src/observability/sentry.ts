import * as Sentry from '@sentry/node';

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });
}

export function captureException(err: unknown, context?: Record<string, unknown>) {
  if (!process.env.SENTRY_DSN) return;
  Sentry.withScope((scope) => {
    if (context) {
      for (const [k, v] of Object.entries(context)) scope.setExtra(k, v);
    }
    Sentry.captureException(err);
  });
}

