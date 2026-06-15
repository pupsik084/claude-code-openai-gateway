import { describe, expect, it } from 'vitest';
import { anthropicToOpenai, mapStopReason } from '../src/translate/anthropicToOpenai.js';
import type { AnthropicMessageResponse } from '../src/types/anthropic.js';

const baseOpts = {
  id: 'chatcmpl-1',
  created: 1718445600,
  requestedModel: 'gpt-4o',
  emitReasoning: true,
};

function resp(partial: Partial<AnthropicMessageResponse>): AnthropicMessageResponse {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content: [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...partial,
  };
}

describe('anthropicToOpenai (non-stream)', () => {
  it('maps text content and usage', () => {
    const out = anthropicToOpenai(resp({ content: [{ type: 'text', text: 'Hello' }] }), baseOpts);
    expect(out.choices[0]!.message.content).toBe('Hello');
    expect(out.choices[0]!.finish_reason).toBe('stop');
    expect(out.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    expect(out.model).toBe('gpt-4o');
  });

  it('maps tool_use blocks into tool_calls with stringified arguments', () => {
    const out = anthropicToOpenai(
      resp({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: 'Paris' } }],
      }),
      baseOpts,
    );
    expect(out.choices[0]!.finish_reason).toBe('tool_calls');
    expect(out.choices[0]!.message.tool_calls?.[0]).toEqual({
      id: 'tu_1',
      type: 'function',
      function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
    });
    expect(out.choices[0]!.message.content).toBeNull();
  });

  it('surfaces thinking blocks as reasoning_content when enabled', () => {
    const out = anthropicToOpenai(
      resp({
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: 'ok' },
        ],
      }),
      baseOpts,
    );
    expect(out.choices[0]!.message.reasoning_content).toBe('hmm');
    expect(out.choices[0]!.message.content).toBe('ok');
  });

  it('maps stop reasons', () => {
    expect(mapStopReason('end_turn')).toBe('stop');
    expect(mapStopReason('max_tokens')).toBe('length');
    expect(mapStopReason('tool_use')).toBe('tool_calls');
    expect(mapStopReason('stop_sequence')).toBe('stop');
    expect(mapStopReason('refusal')).toBe('content_filter');
  });
});
