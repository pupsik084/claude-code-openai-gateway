// OpenAI Chat Completions API types (subset we support).

export type OpenAIRole = 'system' | 'user' | 'assistant' | 'tool';

export interface OpenAITextPart {
  type: 'text';
  text: string;
}

export interface OpenAIImageUrlPart {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export type OpenAIContentPart = OpenAITextPart | OpenAIImageUrlPart;

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAIMessage {
  role: OpenAIRole;
  content: string | OpenAIContentPart[] | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIFunctionTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export type OpenAIToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

export interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stop?: string | string[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  tools?: OpenAIFunctionTool[];
  tool_choice?: OpenAIToolChoice;
  n?: number;
  response_format?: { type: 'text' | 'json_object' };
  user?: string;
}

export type OpenAIFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter';

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAIResponseMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  reasoning_content?: string;
}

export interface OpenAIChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: OpenAIResponseMessage;
    finish_reason: OpenAIFinishReason;
  }>;
  usage: OpenAIUsage;
}

export interface OpenAIDeltaToolCall {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

export interface OpenAIChatCompletionChunkDelta {
  role?: 'assistant';
  content?: string;
  tool_calls?: OpenAIDeltaToolCall[];
  reasoning_content?: string;
}

export interface OpenAIChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: OpenAIChatCompletionChunkDelta;
    finish_reason: OpenAIFinishReason | null;
  }>;
  usage?: OpenAIUsage | null;
}

export interface OpenAIModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export interface OpenAIModelList {
  object: 'list';
  data: OpenAIModel[];
}

export type OpenAIErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'permission_error'
  | 'rate_limit_error'
  | 'api_error';

export interface OpenAIErrorBody {
  error: {
    message: string;
    type: OpenAIErrorType;
    code: string | null;
    param?: string | null;
  };
}
