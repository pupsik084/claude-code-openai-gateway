import { describe, expect, it } from 'vitest';
import { buildSystemBlocks } from '../src/claudecode/systemPrompt.js';
import { CLAUDE_CODE_SYSTEM_PREFIX } from '../src/claudecode/constants.js';

describe('buildSystemBlocks', () => {
  it('puts the mandatory Claude Code prefix as the exact first block', () => {
    const blocks = buildSystemBlocks('be helpful', true);
    expect(blocks).toBeDefined();
    expect(blocks![0]).toEqual({ type: 'text', text: CLAUDE_CODE_SYSTEM_PREFIX });
  });

  it('keeps the user system prompt as a SEPARATE block (not concatenated)', () => {
    const blocks = buildSystemBlocks('be helpful', true)!;
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toEqual({ type: 'text', text: 'be helpful' });
    // The prefix block must not contain the user prompt.
    expect(blocks[0]!.text).toBe(CLAUDE_CODE_SYSTEM_PREFIX);
  });

  it('injects only the prefix when there is no user system prompt', () => {
    const blocks = buildSystemBlocks(undefined, true)!;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe(CLAUDE_CODE_SYSTEM_PREFIX);
  });

  it('omits the prefix when injection is disabled', () => {
    const blocks = buildSystemBlocks('be helpful', false)!;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe('be helpful');
  });

  it('returns undefined when there is nothing to send', () => {
    expect(buildSystemBlocks(undefined, false)).toBeUndefined();
    expect(buildSystemBlocks('   ', false)).toBeUndefined();
  });
});
