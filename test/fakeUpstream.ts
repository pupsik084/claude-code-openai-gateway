import Fastify, { type FastifyInstance } from 'fastify';
import { CLAUDE_CODE_SYSTEM_PREFIX } from '../src/claudecode/constants.js';
import type { AnthropicMessagesRequest } from '../src/types/anthropic.js';

export interface CapturedRequest {
  headers: Record<string, string | string[] | undefined>;
  body: AnthropicMessagesRequest;
}

export interface FakeUpstreamOptions {
  /** Number of leading /v1/messages requests that should return 401 before succeeding. */
  failAuthTimes?: number;
  /** Require oauth-style Bearer auth and enforce the Claude Code system prefix. */
  oauthMode?: boolean;
}

export interface FakeUpstream {
  url: string;
  tokenEndpoint: string;
  requests: CapturedRequest[];
  refreshCount: () => number;
  close: () => Promise<void>;
}

function streamBody(toolCall: boolean): string {
  const events: string[] = [];
  const push = (e: object) => events.push(`event: x\ndata: ${JSON.stringify(e)}\n\n`);
  push({ type: 'message_start', message: { usage: { input_tokens: 11 } } });
  if (toolCall) {
    push({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tu_stream', name: 'get_weather', input: {} },
    });
    push({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"city":' },
    });
    push({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '"Paris"}' },
    });
    push({ type: 'content_block_stop', index: 0 });
    push({
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 6 },
    });
  } else {
    push({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    push({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } });
    push({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } });
    push({ type: 'content_block_stop', index: 0 });
    push({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 7 },
    });
  }
  push({ type: 'message_stop' });
  return events.join('');
}

export async function startFakeUpstream(opts: FakeUpstreamOptions = {}): Promise<FakeUpstream> {
  const app: FastifyInstance = Fastify();
  const requests: CapturedRequest[] = [];
  let authFailsRemaining = opts.failAuthTimes ?? 0;
  let refreshes = 0;

  app.post('/v1/oauth/token', async (_req, reply) => {
    refreshes += 1;
    return reply.send({ access_token: 'sk-ant-oat-refreshed', refresh_token: 'refresh-2' });
  });

  app.post('/v1/messages', async (req, reply) => {
    const body = req.body as AnthropicMessagesRequest;
    requests.push({ headers: req.headers, body });

    if (authFailsRemaining > 0) {
      authFailsRemaining -= 1;
      return reply.code(401).send({ error: { type: 'authentication_error', message: 'expired' } });
    }

    if (opts.oauthMode) {
      const auth = req.headers['authorization'];
      if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
        return reply
          .code(401)
          .send({ error: { type: 'authentication_error', message: 'no bearer' } });
      }
      const first = body.system?.[0];
      const model = body.model ?? '';
      if (!model.includes('haiku') && first?.text !== CLAUDE_CODE_SYSTEM_PREFIX) {
        // Mimic the undocumented 400 "Error" response.
        return reply.code(400).send('Error');
      }
    }

    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;

    if (body.stream) {
      reply.raw.writeHead(200, { 'content-type': 'text/event-stream' });
      reply.raw.write(streamBody(hasTools));
      reply.raw.end();
      return reply;
    }

    if (hasTools) {
      return reply.send({
        id: 'msg_tool',
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [{ type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: 'Paris' } }],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 8 },
      });
    }

    return reply.send({
      id: 'msg_ok',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [{ type: 'text', text: 'Hello world' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 8 },
    });
  });

  const address = await app.listen({ port: 0, host: '127.0.0.1' });

  return {
    url: address,
    tokenEndpoint: `${address}/v1/oauth/token`,
    requests,
    refreshCount: () => refreshes,
    close: () => app.close(),
  };
}
