import { pino } from 'pino';
import type { Config } from '../config.js';

const SECRET_HEADER_KEYS = new Set(['authorization', 'x-api-key', 'cookie', 'set-cookie']);
const SECRET_KEY_RE = /(token|secret|api[-_]?key|password|authorization)/i;

/** Recursively mask secret-looking values for safe logging. */
export function maskSecrets(value: unknown): unknown {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_HEADER_KEYS.has(k.toLowerCase()) || SECRET_KEY_RE.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = maskSecrets(v);
      }
    }
    return out;
  }
  return value;
}

export function createLogger(config: Config) {
  const isDev = process.env['NODE_ENV'] !== 'production';
  return pino({
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-api-key"]',
        'headers.authorization',
        'headers["x-api-key"]',
        '*.authorization',
        '*.token',
      ],
      censor: '[REDACTED]',
    },
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;
