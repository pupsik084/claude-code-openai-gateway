import { describe, expect, it } from 'vitest';
import { GatewayError, mapAnthropicError } from '../src/util/errors.js';

function makeHeaders(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe('mapAnthropicError', () => {
  it('maps 400 to invalid_request_error', () => {
    const err = mapAnthropicError(400, {
      error: { type: 'invalid_request_error', message: 'bad' },
    });
    expect(err.status).toBe(400);
    expect(err.type).toBe('invalid_request_error');
    expect(err.message).toBe('bad');
  });

  it('maps 401 to authentication_error and 403 to permission_error', () => {
    expect(mapAnthropicError(401, {}).type).toBe('authentication_error');
    const e403 = mapAnthropicError(403, {});
    expect(e403.status).toBe(403);
    expect(e403.type).toBe('permission_error');
  });

  it('maps 429 to rate_limit_error and forwards retry-after', () => {
    const err = mapAnthropicError(
      429,
      { error: { message: 'slow down' } },
      makeHeaders({ 'retry-after': '7' }),
    );
    expect(err.status).toBe(429);
    expect(err.type).toBe('rate_limit_error');
    expect(err.retryAfter).toBe('7');
  });

  it('maps 5xx to 502/503 api_error', () => {
    expect(mapAnthropicError(500, {}).status).toBe(502);
    expect(mapAnthropicError(503, {}).status).toBe(503);
    expect(mapAnthropicError(500, {}).type).toBe('api_error');
  });

  it('produces an OpenAI-shaped error body', () => {
    const err = new GatewayError(400, 'invalid_request_error', 'nope', { code: 'x', param: 'n' });
    expect(err.toOpenAIBody()).toEqual({
      error: { message: 'nope', type: 'invalid_request_error', code: 'x', param: 'n' },
    });
  });
});
