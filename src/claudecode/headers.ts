import type { Config } from '../config.js';
import { OAUTH_BETA_FLAG, STAINLESS_LANG, STAINLESS_RUNTIME, X_APP } from './constants.js';

export interface UpstreamCredentials {
  mode: 'api_key' | 'oauth';
  apiKey?: string | undefined;
  oauthToken?: string | undefined;
}

export interface BuildHeadersOptions {
  config: Config;
  creds: UpstreamCredentials;
  sessionId: string;
  agentId?: string;
  parentAgentId?: string;
}

/**
 * Build the outgoing headers for a request to the Anthropic Messages API,
 * emulating the Claude Code CLI. Authentication differs by mode:
 *  - api_key: `x-api-key` only (no Authorization).
 *  - oauth:   `authorization: Bearer ...` only (no x-api-key), and the
 *             anthropic-beta header must include the oauth flag.
 */
export function buildClaudeCodeHeaders(opts: BuildHeadersOptions): Record<string, string> {
  const { config, creds, sessionId, agentId, parentAgentId } = opts;

  const betaFlags = config.ANTHROPIC_BETA.split(',')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);

  if (creds.mode === 'oauth' && !betaFlags.includes(OAUTH_BETA_FLAG)) {
    betaFlags.push(OAUTH_BETA_FLAG);
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    'anthropic-version': config.ANTHROPIC_VERSION,
    'anthropic-beta': betaFlags.join(','),
    'user-agent': `claude-cli/${config.CLAUDE_CODE_VERSION} (external, cli)`,
    'x-app': X_APP,
    'x-stainless-lang': STAINLESS_LANG,
    'x-stainless-runtime': STAINLESS_RUNTIME,
    'X-Claude-Code-Session-Id': sessionId,
  };

  if (agentId) headers['X-Claude-Code-Agent-Id'] = agentId;
  if (parentAgentId) headers['X-Claude-Code-Parent-Agent-Id'] = parentAgentId;

  if (creds.mode === 'oauth') {
    if (!creds.oauthToken) throw new Error('oauth mode requires an oauth token');
    headers['authorization'] = `Bearer ${creds.oauthToken}`;
  } else {
    if (!creds.apiKey) throw new Error('api_key mode requires an api key');
    headers['x-api-key'] = creds.apiKey;
  }

  return headers;
}
