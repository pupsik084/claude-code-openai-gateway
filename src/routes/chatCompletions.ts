import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../server.js';
import { verifyProxyAuth } from '../auth/proxyAuth.js';
import { openaiToAnthropic } from '../translate/openaiToAnthropic.js';
import { anthropicToOpenai } from '../translate/anthropicToOpenai.js';
import { bridgeAnthropicStream } from '../translate/streamBridge.js';
import { parseChatCompletionRequest } from './validation.js';
import { chatCompletionId, sessionIdFrom } from '../util/ids.js';
import { GatewayError } from '../util/errors.js';
import type { AnthropicMessageResponse } from '../types/anthropic.js';

/** Adapt a web ReadableStream (or async iterable) to an async iterable of chunks. */
async function* toAsyncIterable(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<Uint8Array> {
  if (!body) return;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

export function registerChatRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/v1/chat/completions', async (req, reply) => {
    verifyProxyAuth(req, ctx.config.PROXY_API_KEY);

    const parsed = parseChatCompletionRequest(req.body);
    const { body, resolvedModel, usedFallbackModel, fingerprint } = openaiToAnthropic(parsed, {
      modelResolver: ctx.modelResolver,
      defaultMaxTokens: ctx.config.DEFAULT_MAX_TOKENS,
      injectClaudeCodeSystem: ctx.config.INJECT_CLAUDE_CODE_SYSTEM,
    });

    if (usedFallbackModel) {
      ctx.logger.warn(
        { requested: parsed.model, resolved: resolvedModel },
        'Unknown model; falling back to default',
      );
    }

    const clientSessionId = headerString(req, 'x-session-id');
    const sessionId = sessionIdFrom(clientSessionId, fingerprint);

    const abort = new AbortController();
    req.raw.on('close', () => {
      if (!req.raw.readableEnded) abort.abort();
    });

    const id = chatCompletionId();
    const created = Math.floor(Date.now() / 1000);
    const isStream = parsed.stream === true;

    const res = await ctx.client.send(body, {
      sessionId,
      signal: abort.signal,
      requestId: String(req.id),
    });

    if (isStream) {
      return streamResponse(reply, res, {
        id,
        created,
        requestedModel: parsed.model,
        includeUsage: parsed.stream_options?.include_usage === true,
        emitReasoning: ctx.config.EMIT_REASONING_CONTENT,
      });
    }

    const json = (await res.json()) as AnthropicMessageResponse;
    const openai = anthropicToOpenai(json, {
      id,
      created,
      requestedModel: parsed.model,
      emitReasoning: ctx.config.EMIT_REASONING_CONTENT,
    });
    return reply.send(openai);
  });
}

interface StreamOpts {
  id: string;
  created: number;
  requestedModel: string;
  includeUsage: boolean;
  emitReasoning: boolean;
}

async function streamResponse(reply: FastifyReply, res: Response, opts: StreamOpts): Promise<void> {
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  try {
    for await (const chunk of bridgeAnthropicStream(toAsyncIterable(res.body), opts)) {
      reply.raw.write(chunk);
    }
  } catch (err) {
    const message = err instanceof GatewayError ? err.message : 'stream error';
    reply.raw.write(
      `data: ${JSON.stringify({ error: { message, type: 'api_error', code: null } })}\n\n`,
    );
    reply.raw.write('data: [DONE]\n\n');
  } finally {
    reply.raw.end();
  }
}

function headerString(req: FastifyRequest, name: string): string | undefined {
  const value = req.headers[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}
