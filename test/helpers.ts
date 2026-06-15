import { loadConfig, type Config } from '../src/config.js';

/** Build a Config from a minimal env, overriding fields for tests. */
export function testConfig(overrides: Record<string, string> = {}): Config {
  const env: NodeJS.ProcessEnv = {
    PROXY_API_KEY: 'test-proxy-key',
    UPSTREAM_AUTH_MODE: 'api_key',
    ANTHROPIC_API_KEY: 'sk-ant-api-test',
    ...overrides,
  };
  return loadConfig(env);
}
