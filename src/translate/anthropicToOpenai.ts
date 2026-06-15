import type { AnthropicMessageResponse, AnthropicStopReason } from '../types/anthropic.js';
import type {
  OpenAIChatCompletion,
  OpenAIFinishReason,
  OpenAIResponseMessage,
  OpenAIToolCall,
} from '../types/openai.js';

export function mapStopReason(reason: AnthropicStopReason): OpenAIFinishReason {
  switch (reason) {
    case 'end_turn':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    case 'stop_sequence':
      return 'stop';
    case 'refusal':
      return 'content_filter';
    default:
      return 'stop';
  }
}

export interface NonStreamResultOptions {
  id: string;
  created: number;
  requestedModel: string;
  emitReasoning: boolean;
}

export function anthropicToOpenai(
  resp: AnthropicMessageResponse,
  opts: NonStreamResultOptions,
): OpenAIChatCompletion {
  let text = '';
  let reasoning = '';
  const toolCalls: OpenAIToolCall[] = [];

  for (const block of resp.content) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type === 'thinking') {
      reasoning += block.thinking;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
  }

  const message: OpenAIResponseMessage = {
    role: 'assistant',
    content: text.length > 0 || toolCalls.length === 0 ? text : null,
  };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  if (opts.emitReasoning && reasoning) message.reasoning_content = reasoning;

  const promptTokens = resp.usage.input_tokens ?? 0;
  const completionTokens = resp.usage.output_tokens ?? 0;

  return {
    id: opts.id,
    object: 'chat.completion',
    created: opts.created,
    model: opts.requestedModel,
    choices: [
      {
        index: 0,
        message,
        finish_reason: mapStopReason(resp.stop_reason),
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}
