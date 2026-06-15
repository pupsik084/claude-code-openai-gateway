import { z } from 'zod';
import { badRequest } from '../util/errors.js';

const textPart = z.object({ type: z.literal('text'), text: z.string() });
const imagePart = z.object({
  type: z.literal('image_url'),
  image_url: z.object({
    url: z.string(),
    detail: z.enum(['auto', 'low', 'high']).optional(),
  }),
});
const contentPart = z.discriminatedUnion('type', [textPart, imagePart]);
const content = z.union([z.string(), z.array(contentPart)]).nullable();

const toolCall = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

const message = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: content.optional().default(null),
  name: z.string().optional(),
  tool_calls: z.array(toolCall).optional(),
  tool_call_id: z.string().optional(),
});

const functionTool = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  }),
});

const toolChoice = z.union([
  z.enum(['auto', 'none', 'required']),
  z.object({ type: z.literal('function'), function: z.object({ name: z.string() }) }),
]);

export const chatCompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(message).min(1, 'messages must not be empty'),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  stream: z.boolean().optional(),
  stream_options: z.object({ include_usage: z.boolean().optional() }).optional(),
  tools: z.array(functionTool).optional(),
  tool_choice: toolChoice.optional(),
  n: z.number().int().optional(),
  response_format: z.object({ type: z.enum(['text', 'json_object']) }).optional(),
  user: z.string().optional(),
});

export type ValidatedChatRequest = z.infer<typeof chatCompletionRequestSchema>;
export type ValidatedMessage = z.infer<typeof message>;
export type ValidatedContent = z.infer<typeof content>;
export type ValidatedContentPart = z.infer<typeof contentPart>;
export type ValidatedTool = z.infer<typeof functionTool>;
export type ValidatedToolChoice = z.infer<typeof toolChoice>;

export function parseChatCompletionRequest(body: unknown): ValidatedChatRequest {
  const result = chatCompletionRequestSchema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join('.') ?? '';
    throw badRequest(
      first ? `${path ? path + ': ' : ''}${first.message}` : 'Invalid request body',
      path || undefined,
    );
  }
  return result.data;
}
