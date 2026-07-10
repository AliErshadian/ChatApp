import { z } from 'zod';

const NodeEnvSchema = z
  .enum(['development', 'test', 'production'])
  .default('development');

const PLACEHOLDER_SECRET_PATTERNS = [
  /^change-me/i,
  /^your[-_]?secret/i,
  /^replace[-_]?me/i,
  /^example[-_]?secret/i,
  /^secret[-_]?key$/i,
  /^test[-_]?secret/i,
];

const WEAK_DATABASE_PASSWORDS = new Set([
  'chatapp_secret',
  'password',
  'postgres',
  'admin',
  'root',
  '123456',
  '12345678',
]);

const PRODUCTION_LOG_LEVELS = new Set(['info', 'warn', 'error', 'fatal']);

function nonEmpty(name: string) {
  return z.string().trim().min(1, `${name} is required`);
}

function requiredSecret(name: string) {
  return z.string().trim().min(1, `${name} is required`);
}

function isPlaceholderSecret(value: string): boolean {
  return PLACEHOLDER_SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function hasLowEntropySecret(value: string): boolean {
  if (value.length < 32) return true;
  if (new Set(value).size <= 4) return true;
  if (/^(.)\1{7,}/.test(value)) return true;
  return false;
}

function parseDatabasePassword(databaseUrl: string): string | null {
  try {
    const parsed = new URL(databaseUrl);
    return decodeURIComponent(parsed.password);
  } catch {
    return null;
  }
}

function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isValidHttpOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isRedisUrl(value: string): boolean {
  return value.startsWith('redis://') || value.startsWith('rediss://');
}

function isPostgresUrl(value: string): boolean {
  return value.startsWith('postgresql://') || value.startsWith('postgres://');
}

const EnvSchema = z
  .object({
    NODE_ENV: NodeEnvSchema,
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().trim().min(1).default('127.0.0.1'),
    DATABASE_URL: nonEmpty('DATABASE_URL'),
    REDIS_URL: z.string().trim().optional(),
    JWT_ACCESS_SECRET: requiredSecret('JWT_ACCESS_SECRET'),
    JWT_REFRESH_SECRET: requiredSecret('JWT_REFRESH_SECRET'),
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
    if (env.NODE_ENV !== 'production') return;

    if (!env.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required in production',
      });
    } else if (!isRedisUrl(env.REDIS_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'REDIS_URL must start with redis:// or rediss://',
      });
    }

    if (!isPostgresUrl(env.DATABASE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL must be a PostgreSQL connection URL',
      });
    } else {
      const dbPassword = parseDatabasePassword(env.DATABASE_URL);
      if (!dbPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message: 'DATABASE_URL must include a database password in production',
        });
      } else if (WEAK_DATABASE_PASSWORDS.has(dbPassword.toLowerCase())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message: 'DATABASE_URL uses a known weak database password',
        });
      }
    }

    for (const [path, secret] of [
      ['JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET],
      ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET],
    ] as const) {
      if (secret.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: `${path} must be at least 32 characters in production`,
        });
      }
      if (isPlaceholderSecret(secret)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: `${path} must not use a placeholder value in production`,
        });
      }
      if (hasLowEntropySecret(secret)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: `${path} is too weak; use a random secret (e.g. openssl rand -hex 32)`,
        });
      }
    }

    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET in production',
      });
    }

    if (env.CORS_ORIGIN === '*' || env.CORS_ORIGIN.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGIN'],
        message: 'CORS_ORIGIN must be an explicit allowlist in production (not "*")',
      });
    } else {
      const origins = parseCorsOrigins(env.CORS_ORIGIN);
      if (origins.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGIN'],
          message: 'CORS_ORIGIN must list at least one origin in production',
        });
      }
      for (const origin of origins) {
        if (!isValidHttpOrigin(origin)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['CORS_ORIGIN'],
            message: `CORS_ORIGIN contains an invalid URL: ${origin}`,
          });
        }
      }
    }

    const level = (env.LOG_LEVEL ?? 'info').toLowerCase();
    if (!PRODUCTION_LOG_LEVELS.has(level)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LOG_LEVEL'],
        message: 'LOG_LEVEL must be info, warn, error, or fatal in production',
      });
    }
  });

export type AppEnv = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>) {
  const parsed = EnvSchema.safeParse(config);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${message}`);
  }
  return parsed.data;
}

// Exported for lightweight checks in scripts/tests.
export const __envTestUtils = {
  isPlaceholderSecret,
  hasLowEntropySecret,
  parseDatabasePassword,
  parseCorsOrigins,
};
