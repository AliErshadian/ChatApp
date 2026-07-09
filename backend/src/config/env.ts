import { z } from 'zod';

const NodeEnvSchema = z
  .enum(['development', 'test', 'production'])
  .default('development');

function nonEmpty(name: string) {
  return z.string().trim().min(1, `${name} is required`);
}

function strongSecret(name: string) {
  return z
    .string()
    .trim()
    .min(32, `${name} must be at least 32 characters`)
    .refine((v) => !/^change-me/i.test(v), `${name} must not use a placeholder value`);
}

const EnvSchema = z
  .object({
    NODE_ENV: NodeEnvSchema,
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: nonEmpty('DATABASE_URL'),
    REDIS_URL: nonEmpty('REDIS_URL').optional(),
    JWT_ACCESS_SECRET: strongSecret('JWT_ACCESS_SECRET'),
    JWT_REFRESH_SECRET: strongSecret('JWT_REFRESH_SECRET'),
    JWT_ACCESS_EXPIRES_IN: nonEmpty('JWT_ACCESS_EXPIRES_IN').default('15m'),
    JWT_REFRESH_EXPIRES_IN: nonEmpty('JWT_REFRESH_EXPIRES_IN').default('7d'),
    CORS_ORIGIN: nonEmpty('CORS_ORIGIN'),
    RATE_LIMIT_TTL: z.coerce.number().int().min(1).default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
    LOG_LEVEL: z.string().trim().optional(),
    SENTRY_DSN: z.string().trim().optional(),
    SENTRY_RELEASE: z.string().trim().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
    WS_RATE_LIMIT_MESSAGE_SEND_CAPACITY: z.coerce.number().int().min(1).optional(),
    WS_RATE_LIMIT_MESSAGE_SEND_REFILL_PER_SEC: z.coerce.number().min(0.01).optional(),
    WS_RATE_LIMIT_TYPING_CAPACITY: z.coerce.number().int().min(1).optional(),
    WS_RATE_LIMIT_TYPING_REFILL_PER_SEC: z.coerce.number().min(0.01).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (!env.REDIS_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['REDIS_URL'],
          message: 'REDIS_URL is required in production',
        });
      }
      if (env.CORS_ORIGIN === '*' || env.CORS_ORIGIN.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGIN'],
          message: 'CORS_ORIGIN must not be "*" in production',
        });
      }
      const level = (env.LOG_LEVEL ?? '').toLowerCase();
      if (level === 'debug' || level === 'trace') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['LOG_LEVEL'],
          message: 'LOG_LEVEL must not be debug/trace in production',
        });
      }
    }
  });

export type AppEnv = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>) {
  const parsed = EnvSchema.safeParse(config);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'env'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${message}`);
  }
  return parsed.data;
}

