import { createHash, randomUUID } from 'node:crypto';

export function chatCompletionId(): string {
  return `chatcmpl-${randomUUID().replace(/-/g, '')}`;
}

export function toolCallId(): string {
  return `call_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function requestId(): string {
  return randomUUID();
}

/**
 * Derive a stable per-conversation session id. Prefers an explicit client id;
 * otherwise hashes a fingerprint of the conversation so the same conversation
 * maps to the same X-Claude-Code-Session-Id across requests.
 */
export function sessionIdFrom(explicit: string | undefined, fingerprint: string): string {
  if (explicit && explicit.trim()) return explicit.trim();
  const hash = createHash('sha256').update(fingerprint).digest('hex');
  // Format as a UUID-like string for realism.
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join('-');
}
