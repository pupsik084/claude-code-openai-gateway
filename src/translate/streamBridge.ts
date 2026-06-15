import type {
  AnthropicContentBlock,
  AnthropicStopReason,
  AnthropicStreamEvent,
} from '../types/anthropic.js';
import type {
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionChunkDelta,
  OpenAIFinishReason,
} from '../types/openai.js';
import { SSEParser, SSE_DONE, serializeData } from '../util/sse.js';
import { mapStopReason } from './anthropicToOpenai.js';

export interface StreamBridgeOptions {
  id: string;
  created: number;
  requestedModel: string;
  includeUsage: boolean;
  emitReasoning: boolean;
}

type AnyIterable = AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>;

/**
 * State machine translating an Anthropic Messages SSE stream into OpenAI
 * `chat.completion.chunk` SSE strings (terminated by `data: [DONE]`).
 */
export async function* bridgeAnthropicStream(
  source: AnyIterable,
  opts: StreamBridgeOptions,
): AsyncGenerator<string> {
  const parser = new SSEParser();
  const decoder = new TextDecoder();

  let roleEmitted = false;
  let promptTokens = 0;
  let completionTokens = 0;
  let stopReason: AnthropicStopReason = null;
  // Map Anthropic content-block index -> sequential OpenAI tool_call index.
  const toolIndexByBlock = new Map<number, number>();
  let nextToolIndex = 0;

  const baseChunk = (delta: OpenAIChatCompletionChunkDelta, finish: OpenAIFinishReason | null) => {
    const chunk: OpenAIChatCompletionChunk = {
      id: opts.id,
      object: 'chat.completion.chunk',
      created: opts.created,
      model: opts.requestedModel,
      choices: [{ index: 0, delta, finish_reason: finish }],
    };
    return serializeData(JSON.stringify(chunk));
  };

  function* handle(event: AnthropicStreamEvent): Generator<string> {
    switch (event.type) {
      case 'message_start': {
        promptTokens = event.message.usage?.input_tokens ?? 0;
        if (!roleEmitted) {
          roleEmitted = true;
          yield baseChunk({ role: 'assistant' }, null);
        }
        break;
      }
      case 'content_block_start': {
        const block = event.content_block as AnthropicContentBlock;
        if (block.type === 'tool_use') {
          const toolIndex = nextToolIndex++;
          toolIndexByBlock.set(event.index, toolIndex);
          yield baseChunk(
            {
              tool_calls: [
                {
                  index: toolIndex,
                  id: block.id,
                  type: 'function',
                  function: { name: block.name, arguments: '' },
                },
              ],
            },
            null,
          );
        }
        break;
      }
      case 'content_block_delta': {
        const delta = event.delta;
        if (delta.type === 'text_delta') {
          if (delta.text) yield baseChunk({ content: delta.text }, null);
        } else if (delta.type === 'input_json_delta') {
          const toolIndex = toolIndexByBlock.get(event.index) ?? 0;
          yield baseChunk(
            { tool_calls: [{ index: toolIndex, function: { arguments: delta.partial_json } }] },
            null,
          );
        } else if (delta.type === 'thinking_delta' && opts.emitReasoning) {
          if (delta.thinking) yield baseChunk({ reasoning_content: delta.thinking }, null);
        }
        break;
      }
      case 'message_delta': {
        if (event.delta.stop_reason) stopReason = event.delta.stop_reason;
        if (typeof event.usage?.output_tokens === 'number') {
          completionTokens = event.usage.output_tokens;
        }
        break;
      }
      case 'error': {
        // Mid-stream upstream error: surface an error chunk and end the stream.
        yield serializeData(
          JSON.stringify({
            error: { message: event.error?.message ?? 'upstream stream error', type: 'api_error' },
          }),
        );
        break;
      }
      // message_stop handled by the caller after the loop; ping/unknown ignored.
      default:
        break;
    }
  }

  const events: AnthropicStreamEvent[] = [];
  const consume = (messages: { data: string }[]) => {
    for (const msg of messages) {
      if (!msg.data || msg.data === '[DONE]') continue;
      try {
        events.push(JSON.parse(msg.data) as AnthropicStreamEvent);
      } catch {
        // Ignore unparseable SSE payloads (keep-alives etc.).
      }
    }
  };

  for await (const raw of source as AsyncIterable<Uint8Array | string>) {
    const text = typeof raw === 'string' ? raw : decoder.decode(raw, { stream: true });
    consume(parser.push(text));
    while (events.length > 0) {
      const ev = events.shift()!;
      if (ev.type === 'message_stop') {
        yield* finalize();
        return;
      }
      yield* handle(ev);
    }
  }
  consume(parser.flush());
  for (const ev of events) {
    if (ev.type === 'message_stop') {
      yield* finalize();
      return;
    }
    yield* handle(ev);
  }
  // Stream ended without an explicit message_stop — still emit a clean finish.
  yield* finalize();

  function* finalize(): Generator<string> {
    if (!roleEmitted) {
      roleEmitted = true;
      yield baseChunk({ role: 'assistant' }, null);
    }
    const finish = mapStopReason(stopReason);
    yield baseChunk({}, finish);
    if (opts.includeUsage) {
      const usageChunk: OpenAIChatCompletionChunk = {
        id: opts.id,
        object: 'chat.completion.chunk',
        created: opts.created,
        model: opts.requestedModel,
        choices: [],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      };
      yield serializeData(JSON.stringify(usageChunk));
    }
    yield SSE_DONE;
  }
}
