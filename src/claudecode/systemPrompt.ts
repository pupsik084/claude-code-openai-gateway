import type { AnthropicSystemBlock } from '../types/anthropic.js';
import { CLAUDE_CODE_SYSTEM_PREFIX } from './constants.js';

/**
 * Build the Anthropic `system` field as an array of text blocks.
 *
 * When injection is enabled, the FIRST block is exactly the mandatory Claude
 * Code prefix and the user's system prompt is appended as a SEPARATE block.
 * The prefix must NOT be concatenated into the same block as the user prompt —
 * doing so still triggers HTTP 400 in OAuth mode (verified in issue #40515).
 */
export function buildSystemBlocks(
  userSystem: string | undefined,
  injectPrefix: boolean,
): AnthropicSystemBlock[] | undefined {
  const blocks: AnthropicSystemBlock[] = [];

  if (injectPrefix) {
    blocks.push({ type: 'text', text: CLAUDE_CODE_SYSTEM_PREFIX });
  }

  const trimmed = userSystem?.trim();
  if (trimmed) {
    blocks.push({ type: 'text', text: userSystem as string });
  }

  return blocks.length > 0 ? blocks : undefined;
}
