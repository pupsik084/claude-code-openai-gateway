import type { AnthropicImageBlock, AnthropicTextBlock } from '../types/anthropic.js';
import type { ValidatedContent } from '../routes/validation.js';
import { badRequest } from '../util/errors.js';

export type AnthropicUserContent = AnthropicTextBlock | AnthropicImageBlock;

const DATA_URL_RE = /^data:(?<mediaType>[^;,]+)(?<base64>;base64)?,(?<data>.*)$/s;

function imageUrlToAnthropic(url: string): AnthropicImageBlock {
  const match = DATA_URL_RE.exec(url);
  if (match?.groups) {
    const mediaType = match.groups['mediaType'] ?? 'image/png';
    const isBase64 = Boolean(match.groups['base64']);
    const data = match.groups['data'] ?? '';
    if (!isBase64) {
      throw badRequest('Only base64-encoded data URLs are supported for inline images');
    }
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return { type: 'image', source: { type: 'url', url } };
  }
  throw badRequest('Unsupported image_url; expected a data: URL or http(s) URL');
}

/** Convert OpenAI message content (string | parts[]) to Anthropic content blocks. */
export function openaiContentToAnthropic(content: ValidatedContent): AnthropicUserContent[] {
  if (content == null) return [];
  if (typeof content === 'string') {
    return content.length > 0 ? [{ type: 'text', text: content }] : [];
  }

  const blocks: AnthropicUserContent[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text });
    } else if (part.type === 'image_url') {
      blocks.push(imageUrlToAnthropic(part.image_url.url));
    }
  }
  return blocks;
}

/** Flatten OpenAI message content into a plain text string. */
export function openaiContentToText(content: ValidatedContent): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}
