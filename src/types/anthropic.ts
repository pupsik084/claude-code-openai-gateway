// Anthropic Messages API types (subset we use).

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string };
}

export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<AnthropicTextBlock | AnthropicImageBlock>;
  is_error?: boolean;
}

export interface AnthropicThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicThinkingBlock;

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

export interface AnthropicSystemBlock {
  type: 'text';
  text: string;
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export type AnthropicToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'none' }
  | { type: 'tool'; name: string };

export interface AnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  system?: AnthropicSystemBlock[];
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
}

export type AnthropicStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn'
  | 'refusal'
  | null;

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface AnthropicMessageResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: AnthropicStopReason;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

// ── Streaming SSE event shapes ──────────────────────────────────────────────

export interface AnthropicMessageStartEvent {
  type: 'message_start';
  message: AnthropicMessageResponse;
}

export interface AnthropicContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block: AnthropicContentBlock;
}

export interface AnthropicTextDelta {
  type: 'text_delta';
  text: string;
}

export interface AnthropicInputJsonDelta {
  type: 'input_json_delta';
  partial_json: string;
}

export interface AnthropicThinkingDelta {
  type: 'thinking_delta';
  thinking: string;
}

export interface AnthropicSignatureDelta {
  type: 'signature_delta';
  signature: string;
}

export type AnthropicBlockDelta =
  | AnthropicTextDelta
  | AnthropicInputJsonDelta
  | AnthropicThinkingDelta
  | AnthropicSignatureDelta;

export interface AnthropicContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: AnthropicBlockDelta;
}

export interface AnthropicContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

export interface AnthropicMessageDeltaEvent {
  type: 'message_delta';
  delta: { stop_reason: AnthropicStopReason; stop_sequence: string | null };
  usage: { output_tokens: number };
}

export interface AnthropicMessageStopEvent {
  type: 'message_stop';
}

export interface AnthropicPingEvent {
  type: 'ping';
}

export interface AnthropicErrorEvent {
  type: 'error';
  error: { type: string; message: string };
}

export type AnthropicStreamEvent =
  | AnthropicMessageStartEvent
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStopEvent
  | AnthropicPingEvent
  | AnthropicErrorEvent;
