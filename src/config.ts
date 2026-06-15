import { z } from 'zod';

const booleanString = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0', 'yes', 'no']))
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const csvKeys = z
  .string()
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  )
  .pipe(z.array(z.string().min(1)).min(1, 'at least one PROXY_API_KEY is required'));

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('127.0.0.1'),
    PROXY_API_KEY: csvKeys,

    UPSTREAM_BASE_URL: z.string().url().default('https://api.anthropic.com'),
    UPSTREAM_AUTH_MODE: z.enum(['api_key', 'oauth']).default('api_key'),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_OAUTH_TOKEN: z.string().optional(),
    ANTHROPIC_OAUTH_REFRESH_TOKEN: z.string().optional(),

    ANTHROPIC_VERSION: z.string().default('2023-06-01'),
    CLAUDE_CODE_VERSION: z.string().default('2.1.85'),
    ANTHROPIC_BETA: z.string().default('claude-code-20250219'),
    INJECT_CLAUDE_CODE_SYSTEM: booleanString.default('true'),
    OAUTH_TOKEN_ENDPOINT: z.string().url().optional(),
    OAUTH_CLIENT_ID: z.string().optional(),

    DEFAULT_MODEL: z.string().default('claude-sonnet-4-6'),
    MODEL_MAP: z.string().optional(),

    REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
    MAX_RETRIES: z.coerce.number().int().min(0).default(2),
    DEFAULT_MAX_TOKENS: z.coerce.number().int().positive().default(4096),
    MAX_BODY_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 1024 * 1024),
    EMIT_REASONING_CONTENT: booleanString.default('true'),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_BODIES: booleanString.default('false'),
  })
  .superRefine((env, ctx) => {
    if (env.UPSTREAM_AUTH_MODE === 'api_key' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANTHROPIC_API_KEY'],
        message: 'ANTHROPIC_API_KEY is required when UPSTREAM_AUTH_MODE=api_key',
      });
    }
    if (env.UPSTREAM_AUTH_MODE === 'oauth' && !env.ANTHROPIC_OAUTH_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANTHROPIC_OAUTH_TOKEN'],
        message: 'ANTHROPIC_OAUTH_TOKEN is required when UPSTREAM_AUTH_MODE=oauth',
      });
    }
  });

export type Config = z.infer<typeof envSchema> & { modelMap: Record<string, string> };

function parseModelMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('MODEL_MAP must be valid JSON');
  }
  const result = z.record(z.string(), z.string()).safeParse(parsed);
  if (!result.success) {
    throw new Error('MODEL_MAP must be a JSON object of string->string');
  }
  return result.data;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const modelMap = parseModelMap(parsed.data.MODEL_MAP);
  return { ...parsed.data, modelMap };
}
