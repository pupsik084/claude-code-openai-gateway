import { afterEach, describe, expect, it } from 'vitest';
import OpenAI from 'openai';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/util/logger.js';
import { startFakeUpstream, type FakeUpstream } from './fakeUpstream.js';

interface Harness {
  gateway: FastifyInstance;
  upstream: FakeUpstream;
  client: OpenAI;
  baseURL: string;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function startHarness(
  envOverrides: Record<string, string> = {},
  upstream?: FakeUpstream,
): Promise<Harness> {
  const up = upstream ?? (await startFakeUpstream());
  const config = loadConfig({
    PROXY_API_KEY: 'proxy-secret',
    UPSTREAM_AUTH_MODE: 'api_key',
    ANTHROPIC_API_KEY: 'sk-ant-api-test',
    UPSTREAM_BASE_URL: up.url,
    LOG_LEVEL: 'silent',
    ...envOverrides,
  } as NodeJS.ProcessEnv);

  const gateway = await buildServer(config, createLogger(config));
  const address = await gateway.listen({ port: 0, host: '127.0.0.1' });

  cleanups.push(() => gateway.close());
  if (!upstream) cleanups.push(() => up.close());

  const baseURL = `${address}/v1`;
  const client = new OpenAI({ apiKey: 'proxy-secret', baseURL });
  return { gateway, upstream: up, client, baseURL };
}

describe('integration: /v1/chat/completions', () => {
  it('non-stream happy path via the OpenAI SDK', async () => {
    const { client, upstream } = await startHarness();
    const res = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(res.choices[0]!.message.content).toBe('Hello world');
    expect(res.usage).toMatchObject({ prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 });

    // Upstream received Claude Code emulation headers + system prefix.
    const captured = upstream.requests[0]!;
    expect(captured.headers['user-agent']).toMatch(/^claude-cli\//);
    expect(captured.headers['x-app']).toBe('cli');
    expect(captured.body.system?.[0]?.text).toContain('You are Claude Code');
    expect(captured.body.model).toBe('claude-sonnet-4-6');
  });

  it('streaming happy path yields ordered chunks', async () => {
    const { client } = await startHarness();
    const stream = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });
    let content = '';
    let finish: string | null = null;
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta.content ?? '';
      if (chunk.choices[0]?.finish_reason) finish = chunk.choices[0].finish_reason;
    }
    expect(content).toBe('Hello world');
    expect(finish).toBe('stop');
  });

  it('tool-calling round-trip (stream tool_use, then tool result)', async () => {
    const { client, upstream } = await startHarness();
    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'get_weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        },
      },
    ];

    const stream = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'weather in Paris?' }],
      tools,
      stream: true,
    });

    let toolName = '';
    let args = '';
    let toolId = '';
    for await (const chunk of stream) {
      const tc = chunk.choices[0]?.delta.tool_calls?.[0];
      if (tc?.function?.name) toolName = tc.function.name;
      if (tc?.id) toolId = tc.id;
      if (tc?.function?.arguments) args += tc.function.arguments;
    }
    expect(toolName).toBe('get_weather');
    expect(JSON.parse(args)).toEqual({ city: 'Paris' });

    // Client sends the tool result back; second request must translate cleanly.
    const followup = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: 'weather in Paris?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: toolId, type: 'function', function: { name: 'get_weather', arguments: args } },
          ],
        },
        { role: 'tool', tool_call_id: toolId, content: '20C and sunny' },
      ],
    });
    expect(followup.choices[0]!.message.content).toBe('Hello world');

    const last = upstream.requests[upstream.requests.length - 1]!;
    const toolResultMsg = last.body.messages.find((m) =>
      m.content.some((b) => b.type === 'tool_result'),
    );
    expect(toolResultMsg).toBeDefined();
  });

  it('rejects downstream requests without a valid proxy key', async () => {
    const { baseURL } = await startHarness();
    const bad = new OpenAI({ apiKey: 'wrong-key', baseURL });
    await expect(
      bad.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('refreshes the OAuth token on a 401 and retries successfully', async () => {
    const upstream = await startFakeUpstream({ failAuthTimes: 1, oauthMode: true });
    const { client } = await startHarness(
      {
        UPSTREAM_AUTH_MODE: 'oauth',
        ANTHROPIC_OAUTH_TOKEN: 'sk-ant-oat-old',
        ANTHROPIC_OAUTH_REFRESH_TOKEN: 'refresh-1',
        OAUTH_TOKEN_ENDPOINT: upstream.tokenEndpoint,
      },
      upstream,
    );

    const res = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.choices[0]!.message.content).toBe('Hello world');
    expect(upstream.refreshCount()).toBe(1);
    // First request used the old token, retry used the refreshed token.
    expect(upstream.requests[upstream.requests.length - 1]!.headers['authorization']).toBe(
      'Bearer sk-ant-oat-refreshed',
    );
  });
});

describe('integration: /v1/models and health', () => {
  it('lists models in OpenAI shape', async () => {
    const { client } = await startHarness();
    const models = await client.models.list();
    const ids = models.data.map((m) => m.id);
    expect(ids).toContain('gpt-4o');
    expect(models.data[0]!.object).toBe('model');
    expect(models.data[0]!.owned_by).toBe('anthropic');
  });

  it('healthz and readyz respond', async () => {
    const { baseURL } = await startHarness();
    const root = baseURL.replace(/\/v1$/, '');
    const health = await fetch(`${root}/healthz`);
    expect(health.status).toBe(200);
    const ready = await fetch(`${root}/readyz`);
    expect(ready.status).toBe(200);
  });
});
