import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { unauthorized } from '../util/errors.js';

function extractKey(req: FastifyRequest): string | undefined {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey.length > 0) return xApiKey.trim();
  return undefined;
}

function constantTimeIncludes(allowed: string[], candidate: string): boolean {
  const candidateBuf = Buffer.from(candidate);
  // Compare against every key in constant time per-key to avoid early exit leaks.
  let matched = false;
  for (const key of allowed) {
    const keyBuf = Buffer.from(key);
    if (keyBuf.length === candidateBuf.length && timingSafeEqual(keyBuf, candidateBuf)) {
      matched = true;
    }
  }
  return matched;
}

/** Validate the downstream client's proxy API key. Throws GatewayError(401). */
export function verifyProxyAuth(req: FastifyRequest, allowedKeys: string[]): void {
  const candidate = extractKey(req);
  if (!candidate) {
    throw unauthorized('Missing API key. Provide Authorization: Bearer <PROXY_API_KEY>.');
  }
  if (!constantTimeIncludes(allowedKeys, candidate)) {
    throw unauthorized('Incorrect API key provided.');
  }
}
