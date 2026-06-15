import { describe, expect, it } from 'vitest';
import { openaiToAnthropic, type TranslateOptions } from '../src/translate/openaiToAnthropic.js';
import { ModelResolver } from '../src/models/modelMap.js';
import { CLAUDE_CODE_SYSTEM_PREFIX } from '../src/claudecode/constants.js';
import { parseChatCompletionRequest } from '../src/routes/validation.js';

const opts: TranslateOptions = {
  modelResolver: new ModelResolver({ defaultModel: 'claude-sonnet-4-6' }),
  defaultMaxTokens: 4096,
  injectClaudeCodeSystem: true,
};

function translate(body: unknown, o: TranslateOptions = opts) {
  return openaiToAnthropic(parseChatCompletionRequest(body), o);
}

describe('openaiToAnthropic', () => {
  it('moves system messages to top-level system with the Claude Code prefix first', () => {
    const { body } = translate({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are terse.' },
        { role: 'user', content: 'Hi' },
      ],
    });
    expect(body.system?.[0]).toEqual({ type: 'text', text: CLAUDE_CODE_SYSTEM_PREFIX });
    expect(body.system?.[1]).toEqual({ type: 'text', text: 'You are terse.' });
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }]);
  });

  it('defaults max_tokens when omitted and resolves the model', () => {
    const { body } = translate({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }] });
    expect(body.max_tokens).toBe(4096);
    expect(body.model).toBe('claude-sonnet-4-6');
  });

  it('merges consecutive same-role messages to keep roles alternating', () => {
    const { body } = translate({
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'assistant', content: 'c' },
        { role: 'assistant', content: 'd' },
      ],
    });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ],
    });
    expect(body.messages[1]!.role).toBe('assistant');
  });

  it('translates tools to input_schema and tool_choice variants', () => {
    const tool = {
      type: 'function' as const,
      function: {
        name: 'get_weather',
        description: 'Get weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    };
    const { body } = translate({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'weather?' }],
      tools: [tool],
      tool_choice: 'required',
    });
    expect(body.tools?.[0]).toEqual({
      name: 'get_weather',
      description: 'Get weather',
      input_schema: { type: 'object', properties: { city: { type: 'string' } } },
    });
    expect(body.tool_choice).toEqual({ type: 'any' });
  });

  it('translates a specific function tool_choice', () => {
    const { body } = translate({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ type: 'function', function: { name: 'f' } }],
      tool_choice: { type: 'function', function: { name: 'f' } },
    });
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'f' });
  });

  it('converts assistant tool_calls (JSON string) into tool_use blocks (object input)', () => {
    const { body } = translate({
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: 'weather?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: '20C' },
      ],
    });
    const assistant = body.messages[1]!;
    expect(assistant.content[0]).toEqual({
      type: 'tool_use',
      id: 'call_1',
      name: 'get_weather',
      input: { city: 'Paris' },
    });
    const toolResult = body.messages[2]!;
    expect(toolResult.role).toBe('user');
    expect(toolResult.content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'call_1',
      content: '20C',
    });
  });

  it('translates image_url data URLs into base64 image blocks', () => {
    const { body } = translate({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          ],
        },
      ],
    });
    expect(body.messages[0]!.content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    });
  });

  it('maps stop -> stop_sequences and passes temperature/top_p', () => {
    const { body } = translate({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'x' }],
      stop: ['\n\nHuman:'],
      temperature: 0.5,
      top_p: 0.9,
    });
    expect(body.stop_sequences).toEqual(['\n\nHuman:']);
    expect(body.temperature).toBe(0.5);
    expect(body.top_p).toBe(0.9);
  });

  it('rejects n != 1', () => {
    expect(() =>
      translate({ model: 'gpt-4o', messages: [{ role: 'user', content: 'x' }], n: 2 }),
    ).toThrowError(/n=1/);
  });
});
