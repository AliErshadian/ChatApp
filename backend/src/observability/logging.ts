import pinoHttp from 'pino-http';

export function createHttpLogger() {
  const isProd = process.env.NODE_ENV === 'production';

  return pinoHttp({
    level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.refreshToken',
        'res.headers["set-cookie"]',
      ],
      censor: '[REDACTED]',
    },
    transport: isProd
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard', singleLine: true },
        },
    customProps: (req) => ({
      requestId: (req as any).requestId,
    }),
    customSuccessMessage: (req, res) =>
      `${req.method} ${req.url} ${res.statusCode}`,
    customErrorMessage: (req, res, err) =>
      `${req.method} ${req.url} ${res.statusCode} - ${err?.message ?? 'error'}`,
  });
}

