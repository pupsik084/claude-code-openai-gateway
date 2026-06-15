import { describe, expect, it } from 'vitest';
import { bridgeAnthropicStream, type StreamBridgeOptions } from '../src/translate/streamBridge.js';
import type { OpenAIChatCompletionChunk } from '../src/types/openai.js';

const opts: StreamBridgeOptions = {
  id: 'chatcmpl-1',
  created: 1718445600,
  requestedModel: 'gpt-4o',
  includeUsage: false,
  emitReasoning: true,
};

/** Serialize Anthropic stream events as SSE text (one event per call). */
function sse(events: object[]): string {
  return events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

async function* single(text: string): AsyncGenerator<string> {
  yield text;
}

async function collect(input: string, o: StreamBridgeOptions = opts): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of bridgeAnthropicStream(single(input), o)) out.push(chunk);
  return out;
}

function parseChunks(raw: string[]): OpenAIChatCompletionChunk[] {
  return raw
    .filter((c) => c.startsWith('data: ') && !c.includes('[DONE]'))
    .map((c) => JSON.parse(c.slice('data: '.length).trim()) as OpenAIChatCompletionChunk);
}

describe('bridgeAnthropicStream', () => {
  it('bridges a text-only stream and terminates with [DONE]', async () => {
    const input = sse([
      { type: 'message_start', message: { usage: { input_tokens: 3 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 2 },
      },
      { type: 'message_stop' },
    ]);
    const raw = await collect(input);
    expect(raw[raw.length - 1]).toBe('data: [DONE]\n\n');

    const chunks = parseChunks(raw);
    expect(chunks[0]!.choices[0]!.delta).toEqual({ role: 'assistant' });
    const text = chunks.map((c) => c.choices[0]?.delta.content ?? '').join('');
    expect(text).toBe('Hello');
    const last = chunks[chunks.length - 1]!;
    expect(last.choices[0]!.finish_reason).toBe('stop');
  });

  it('bridges tool_use with input_json_delta into tool_calls deltas', async () => {
    const input = sse([
      { type: 'message_start', message: { usage: { input_tokens: 5 } } },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'get_weather', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"ci' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: 'ty":"Paris"}' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 9 },
      },
      { type: 'message_stop' },
    ]);
    const chunks = parseChunks(await collect(input));

    const startChunk = chunks.find((c) => c.choices[0]?.delta.tool_calls?.[0]?.id === 'tu_1')!;
    expect(startChunk.choices[0]!.delta.tool_calls![0]).toMatchObject({
      index: 0,
      id: 'tu_1',
      type: 'function',
      function: { name: 'get_weather', arguments: '' },
    });

    const args = chunks
      .map((c) => c.choices[0]?.delta.tool_calls?.[0]?.function?.arguments ?? '')
      .join('');
    expect(args).toBe('{"city":"Paris"}');

    expect(chunks[chunks.length - 1]!.choices[0]!.finish_reason).toBe('tool_calls');
  });

  it('emits reasoning_content for thinking deltas', async () => {
    const input = sse([
      { type: 'message_start', message: { usage: { input_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'pondering' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 1 },
      },
      { type: 'message_stop' },
    ]);
    const chunks = parseChunks(await collect(input));
    const reasoning = chunks.map((c) => c.choices[0]?.delta.reasoning_content ?? '').join('');
    expect(reasoning).toBe('pondering');
  });

  it('emits a usage chunk when include_usage is set', async () => {
    const input = sse([
      { type: 'message_start', message: { usage: { input_tokens: 7 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 4 },
      },
      { type: 'message_stop' },
    ]);
    const chunks = parseChunks(await collect(input, { ...opts, includeUsage: true }));
    const usageChunk = chunks.find((c) => c.usage != null)!;
    expect(usageChunk.usage).toEqual({ prompt_tokens: 7, completion_tokens: 4, total_tokens: 11 });
    expect(usageChunk.choices).toEqual([]);
  });

  it('ignores ping events and split chunks across reads', async () => {
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 1 } } },
      { type: 'ping' },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 1 },
      },
      { type: 'message_stop' },
    ];
    const full = sse(events);
    // Split mid-event to exercise the incremental parser.
    const mid = Math.floor(full.length / 2);
    async function* chunked(): AsyncGenerator<string> {
      yield full.slice(0, mid);
      yield full.slice(mid);
    }
    const out: string[] = [];
    for await (const c of bridgeAnthropicStream(chunked(), opts)) out.push(c);
    const text = parseChunks(out)
      .map((c) => c.choices[0]?.delta.content ?? '')
      .join('');
    expect(text).toBe('ok');
    expect(out[out.length - 1]).toBe('data: [DONE]\n\n');
  });
});
