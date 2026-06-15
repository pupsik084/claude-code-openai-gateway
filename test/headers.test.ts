import { describe, expect, it } from 'vitest';
import { buildClaudeCodeHeaders } from '../src/claudecode/headers.js';
import { OAUTH_BETA_FLAG } from '../src/claudecode/constants.js';
import { testConfig } from './helpers.js';

describe('buildClaudeCodeHeaders', () => {
  it('builds api_key headers with x-api-key and no Authorization', () => {
    const config = testConfig({ UPSTREAM_AUTH_MODE: 'api_key', ANTHROPIC_API_KEY: 'sk-ant-api-x' });
    const h = buildClaudeCodeHeaders({
      config,
      creds: { mode: 'api_key', apiKey: 'sk-ant-api-x' },
      sessionId: 'sess-1',
    });
    expect(h['x-api-key']).toBe('sk-ant-api-x');
    expect(h['authorization']).toBeUndefined();
    expect(h['user-agent']).toBe(`claude-cli/${config.CLAUDE_CODE_VERSION} (external, cli)`);
    expect(h['x-app']).toBe('cli');
    expect(h['x-stainless-lang']).toBe('js');
    expect(h['x-stainless-runtime']).toBe('node');
    expect(h['X-Claude-Code-Session-Id']).toBe('sess-1');
    expect(h['anthropic-version']).toBe('2023-06-01');
  });

  it('does NOT add the oauth beta flag in api_key mode', () => {
    const config = testConfig({ ANTHROPIC_BETA: 'claude-code-20250219' });
    const h = buildClaudeCodeHeaders({
      config,
      creds: { mode: 'api_key', apiKey: 'k' },
      sessionId: 's',
    });
    expect(h['anthropic-beta']).toBe('claude-code-20250219');
    expect(h['anthropic-beta']).not.toContain(OAUTH_BETA_FLAG);
  });

  it('builds oauth headers with Bearer and the oauth beta flag, no x-api-key', () => {
    const config = testConfig({
      UPSTREAM_AUTH_MODE: 'oauth',
      ANTHROPIC_OAUTH_TOKEN: 'sk-ant-oat-x',
      ANTHROPIC_BETA: 'claude-code-20250219',
    });
    const h = buildClaudeCodeHeaders({
      config,
      creds: { mode: 'oauth', oauthToken: 'sk-ant-oat-x' },
      sessionId: 's',
    });
    expect(h['authorization']).toBe('Bearer sk-ant-oat-x');
    expect(h['x-api-key']).toBeUndefined();
    expect(h['anthropic-beta']).toContain(OAUTH_BETA_FLAG);
  });

  it('does not duplicate the oauth beta flag if already present', () => {
    const config = testConfig({
      UPSTREAM_AUTH_MODE: 'oauth',
      ANTHROPIC_OAUTH_TOKEN: 't',
      ANTHROPIC_BETA: `claude-code-20250219,${OAUTH_BETA_FLAG}`,
    });
    const h = buildClaudeCodeHeaders({
      config,
      creds: { mode: 'oauth', oauthToken: 't' },
      sessionId: 's',
    });
    const count = h['anthropic-beta']!.split(',').filter((f) => f === OAUTH_BETA_FLAG).length;
    expect(count).toBe(1);
  });

  it('adds agent id headers when provided', () => {
    const config = testConfig();
    const h = buildClaudeCodeHeaders({
      config,
      creds: { mode: 'api_key', apiKey: 'k' },
      sessionId: 's',
      agentId: 'agent-1',
      parentAgentId: 'parent-1',
    });
    expect(h['X-Claude-Code-Agent-Id']).toBe('agent-1');
    expect(h['X-Claude-Code-Parent-Agent-Id']).toBe('parent-1');
  });
});
