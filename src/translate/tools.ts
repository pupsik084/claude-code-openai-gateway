import type { AnthropicTool, AnthropicToolChoice } from '../types/anthropic.js';
import type { ValidatedTool, ValidatedToolChoice } from '../routes/validation.js';
import { badRequest } from '../util/errors.js';

/** OpenAI `tools[].function` -> Anthropic `tools[]`. The JSON Schema in
 * `function.parameters` maps directly onto Anthropic's `input_schema`. */
export function openaiToolsToAnthropic(
  tools: ValidatedTool[] | undefined,
): AnthropicTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => {
    const tool: AnthropicTool = {
      name: t.function.name,
      input_schema: t.function.parameters ?? { type: 'object', properties: {} },
    };
    if (t.function.description !== undefined) tool.description = t.function.description;
    return tool;
  });
}

/** OpenAI `tool_choice` -> Anthropic `tool_choice`. */
export function openaiToolChoiceToAnthropic(
  choice: ValidatedToolChoice | undefined,
): AnthropicToolChoice | undefined {
  if (choice === undefined) return undefined;
  if (choice === 'auto') return { type: 'auto' };
  if (choice === 'none') return { type: 'none' };
  if (choice === 'required') return { type: 'any' };
  if (typeof choice === 'object' && choice.type === 'function') {
    return { type: 'tool', name: choice.function.name };
  }
  throw badRequest('Unsupported tool_choice value', 'tool_choice');
}

/** Parse an OpenAI tool_call.arguments JSON string into an object for Anthropic. */
export function parseToolArguments(args: string | undefined): Record<string, unknown> {
  if (!args || args.trim() === '') return {};
  try {
    const parsed = JSON.parse(args);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    throw badRequest('tool_calls[].function.arguments must be a valid JSON string');
  }
}
