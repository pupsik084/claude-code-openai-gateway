import type { OpenAIErrorBody, OpenAIErrorType } from '../types/openai.js';

/** A gateway error that carries an HTTP status and maps to an OpenAI error body. */
export class GatewayError extends Error {
  readonly status: number;
  readonly type: OpenAIErrorType;
  readonly code: string | null;
  readonly retryAfter?: string;
  readonly param?: string | null;

  constructor(
    status: number,
    type: OpenAIErrorType,
    message: string,
    opts: { code?: string | null; retryAfter?: string; param?: string | null } = {},
  ) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.type = type;
    this.code = opts.code ?? null;
    if (opts.retryAfter !== undefined) this.retryAfter = opts.retryAfter;
    if (opts.param !== undefined) this.param = opts.param;
  }

  toOpenAIBody(): OpenAIErrorBody {
    return {
      error: {
        message: this.message,
        type: this.type,
        code: this.code,
        ...(this.param !== undefined ? { param: this.param } : {}),
      },
    };
  }
}

export function badRequest(message: string, param?: string): GatewayError {
  return new GatewayError(400, 'invalid_request_error', message, { param: param ?? null });
}

export function unauthorized(message = 'Invalid authentication credentials'): GatewayError {
  return new GatewayError(401, 'authentication_error', message);
}

interface AnthropicErrorShape {
  type?: string;
  error?: { type?: string; message?: string };
}

/**
 * Map an upstream Anthropic HTTP error to a GatewayError in OpenAI shape.
 * Status mapping: 400->400, 401/403 passthrough, 429->429 (with retry-after),
 * 5xx -> 502/503.
 */
export function mapAnthropicError(status: number, body: unknown, headers?: Headers): GatewayError {
  const parsed = (typeof body === 'object' && body !== null ? body : {}) as AnthropicErrorShape;
  const upstreamMessage =
    parsed.error?.message ?? (typeof body === 'string' ? body : 'Upstream error');
  const upstreamType = parsed.error?.type;

  const retryAfter = headers?.get('retry-after') ?? undefined;

  if (status === 400) {
    return new GatewayError(400, 'invalid_request_error', upstreamMessage, {
      code: upstreamType ?? null,
    });
  }
  if (status === 401) {
    return new GatewayError(401, 'authentication_error', upstreamMessage);
  }
  if (status === 403) {
    return new GatewayError(403, 'permission_error', upstreamMessage);
  }
  if (status === 429) {
    return new GatewayError(429, 'rate_limit_error', upstreamMessage, {
      ...(retryAfter !== undefined ? { retryAfter } : {}),
    });
  }
  if (status >= 500) {
    const mapped = status === 503 ? 503 : 502;
    return new GatewayError(mapped, 'api_error', upstreamMessage);
  }
  return new GatewayError(status, 'api_error', upstreamMessage);
}
