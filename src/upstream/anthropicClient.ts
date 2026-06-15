import type { Config } from '../config.js';
import { buildClaudeCodeHeaders } from '../claudecode/headers.js';
import type { UpstreamCredentialStore } from '../auth/upstreamCreds.js';
import type { AnthropicMessagesRequest } from '../types/anthropic.js';
import { GatewayError, mapAnthropicError } from '../util/errors.js';
import type { Logger } from '../util/logger.js';

export interface SendOptions {
  sessionId: string;
  signal?: AbortSignal;
  requestId: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function backoffDelay(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds)) return Math.min(seconds * 1000, 30_000);
  }
  const base = Math.min(1000 * 2 ** attempt, 16_000);
  return base + Math.floor(Math.random() * 250);
}

export class AnthropicClient {
  constructor(
    private readonly config: Config,
    private readonly creds: UpstreamCredentialStore,
    private readonly logger: Logger,
  ) {}

  private url(): string {
    return `${this.config.UPSTREAM_BASE_URL.replace(/\/$/, '')}/v1/messages`;
  }

  /**
   * POST to the Anthropic Messages API emulating Claude Code. Retries 429/5xx
   * with exponential backoff, and on a 401 in oauth mode attempts a single
   * token refresh + retry. Returns the raw Response (caller handles json/stream).
   */
  async send(body: AnthropicMessagesRequest, opts: SendOptions): Promise<Response> {
    const payload = JSON.stringify(body);
    let refreshed = false;

    for (let attempt = 0; ; attempt++) {
      const headers = buildClaudeCodeHeaders({
        config: this.config,
        creds: this.creds.current(),
        sessionId: opts.sessionId,
      });

      const timeout = AbortSignal.timeout(this.config.REQUEST_TIMEOUT_MS);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

      let res: Response;
      try {
        res = await fetch(this.url(), { method: 'POST', headers, body: payload, signal });
      } catch (err) {
        if (opts.signal?.aborted) {
          throw new GatewayError(499, 'api_error', 'Client closed request');
        }
        if (attempt < this.config.MAX_RETRIES) {
          await sleep(backoffDelay(attempt, null));
          continue;
        }
        throw new GatewayError(502, 'api_error', `Upstream request failed: ${String(err)}`);
      }

      if (res.ok) return res;

      // 401 in oauth mode -> try a single refresh + retry.
      if (res.status === 401 && !refreshed && this.creds.canRefresh()) {
        refreshed = true;
        const ok = await this.creds.refresh();
        if (ok) {
          this.logger.warn({ requestId: opts.requestId }, 'Retrying after OAuth refresh');
          continue;
        }
      }

      const shouldRetry = res.status === 429 || res.status >= 500;
      if (shouldRetry && attempt < this.config.MAX_RETRIES) {
        const delay = backoffDelay(attempt, res.headers.get('retry-after'));
        this.logger.warn(
          { requestId: opts.requestId, status: res.status, attempt, delay },
          'Retrying upstream request',
        );
        await res.body?.cancel().catch(() => {});
        await sleep(delay);
        continue;
      }

      throw await this.toError(res);
    }
  }

  private async toError(res: Response): Promise<GatewayError> {
    let parsed: unknown;
    const raw = await res.text().catch(() => '');
    try {
      parsed = raw ? JSON.parse(raw) : '';
    } catch {
      parsed = raw;
    }

    const error = mapAnthropicError(res.status, parsed, res.headers);

    // Special diagnostic for the undocumented OAuth system-prefix requirement.
    if (
      res.status === 400 &&
      this.config.UPSTREAM_AUTH_MODE === 'oauth' &&
      /(^|")error("|$)/i.test(raw.trim())
    ) {
      this.logger.error(
        'Upstream returned 400 "Error" in oauth mode — likely missing the mandatory Claude Code ' +
          'system prefix. Ensure INJECT_CLAUDE_CODE_SYSTEM=true (see README §Claude Code emulation).',
      );
    }
    return error;
  }
}
