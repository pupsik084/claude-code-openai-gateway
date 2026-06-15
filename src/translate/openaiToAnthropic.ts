import { buildSystemBlocks } from '../claudecode/systemPrompt.js';
import type { ModelResolver } from '../models/modelMap.js';
import type {
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicMessagesRequest,
} from '../types/anthropic.js';
import type { ValidatedChatRequest, ValidatedMessage } from '../routes/validation.js';
import { badRequest } from '../util/errors.js';
import { openaiContentToAnthropic, openaiContentToText } from './content.js';
import {
  openaiToolChoiceToAnthropic,
  openaiToolsToAnthropic,
  parseToolArguments,
} from './tools.js';

export interface TranslateOptions {
  modelResolver: ModelResolver;
  defaultMaxTokens: number;
  injectClaudeCodeSystem: boolean;
}

export interface TranslateResult {
  body: AnthropicMessagesRequest;
  resolvedModel: string;
  usedFallbackModel: boolean;
  /** Stable fingerprint of the conversation, used to derive a session id. */
  fingerprint: string;
}

function normalizeStop(stop: string | string[] | undefined): string[] | undefined {
  if (stop === undefined) return undefined;
  const arr = Array.isArray(stop) ? stop : [stop];
  const filtered = arr.filter((s) => typeof s === 'string' && s.length > 0);
  return filtered.length > 0 ? filtered : undefined;
}

/** Convert one OpenAI assistant message into Anthropic content blocks. */
function assistantBlocks(msg: ValidatedMessage): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];
  const text = openaiContentToText(msg.content);
  if (text) blocks.push({ type: 'text', text });
  for (const call of msg.tool_calls ?? []) {
    blocks.push({
      type: 'tool_use',
      id: call.id,
      name: call.function.name,
      input: parseToolArguments(call.function.arguments),
    });
  }
  return blocks;
}

/** Append a message, merging into the previous one if roles match (Anthropic
 * requires strictly alternating user/assistant roles). */
function pushMerging(
  messages: AnthropicMessage[],
  role: 'user' | 'assistant',
  content: AnthropicContentBlock[],
): void {
  if (content.length === 0) return;
  const last = messages[messages.length - 1];
  if (last && last.role === role) {
    last.content.push(...content);
  } else {
    messages.push({ role, content });
  }
}

export function openaiToAnthropic(
  req: ValidatedChatRequest,
  opts: TranslateOptions,
): TranslateResult {
  if (req.n !== undefined && req.n !== 1) {
    throw badRequest('Only n=1 is supported', 'n');
  }

  // 1. System: collect all role:system messages -> top-level system blocks.
  const systemTexts: string[] = [];
  const conversation: ValidatedMessage[] = [];
  for (const msg of req.messages) {
    if (msg.role === 'system') {
      const text = openaiContentToText(msg.content);
      if (text) systemTexts.push(text);
    } else {
      conversation.push(msg);
    }
  }

  if (req.response_format?.type === 'json_object') {
    systemTexts.push('You must respond with a single valid JSON object and nothing else.');
  }

  const userSystem = systemTexts.length > 0 ? systemTexts.join('\n\n') : undefined;
  const system = buildSystemBlocks(userSystem, opts.injectClaudeCodeSystem);

  // 2. History -> alternating Anthropic messages.
  const messages: AnthropicMessage[] = [];
  for (const msg of conversation) {
    switch (msg.role) {
      case 'user':
        pushMerging(messages, 'user', openaiContentToAnthropic(msg.content));
        break;
      case 'assistant':
        pushMerging(messages, 'assistant', assistantBlocks(msg));
        break;
      case 'tool': {
        if (!msg.tool_call_id) {
          throw badRequest('tool messages must include tool_call_id');
        }
        pushMerging(messages, 'user', [
          {
            type: 'tool_result',
            tool_use_id: msg.tool_call_id,
            content: openaiContentToText(msg.content),
          },
        ]);
        break;
      }
      default:
        throw badRequest(`Unsupported message role: ${String(msg.role)}`);
    }
  }

  // 3 & 4. Params + model.
  const { model, fallback } = opts.modelResolver.resolve(req.model);
  const maxTokens = req.max_tokens ?? req.max_completion_tokens ?? opts.defaultMaxTokens;

  const tools = openaiToolsToAnthropic(req.tools);
  const toolChoice = openaiToolChoiceToAnthropic(req.tool_choice);
  const stopSequences = normalizeStop(req.stop);

  const body: AnthropicMessagesRequest = {
    model,
    max_tokens: maxTokens,
    messages,
  };
  if (system) body.system = system;
  if (tools) body.tools = tools;
  // Only send tool_choice when tools are present; "none" is expressed by omitting tools.
  if (tools && toolChoice && toolChoice.type !== 'none') body.tool_choice = toolChoice;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.top_p !== undefined) body.top_p = req.top_p;
  if (stopSequences) body.stop_sequences = stopSequences;
  if (req.stream) body.stream = true;

  const fingerprint = JSON.stringify({ system: userSystem ?? '', messages });

  return { body, resolvedModel: model, usedFallbackModel: fallback, fingerprint };
}
