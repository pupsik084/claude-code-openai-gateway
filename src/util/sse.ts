// Minimal Server-Sent Events parser and serializer.

export interface SSEMessage {
  event?: string;
  data: string;
}

/**
 * Incremental SSE parser. Feed it raw chunks; it yields complete events as they
 * become available. SSE events are separated by a blank line; `data:` lines are
 * concatenated with newlines.
 */
export class SSEParser {
  private buffer = '';

  push(chunk: string): SSEMessage[] {
    this.buffer += chunk;
    const messages: SSEMessage[] = [];

    let sepIndex: number;
    // Events are delimited by a blank line. Normalize CRLF to LF first.
    this.buffer = this.buffer.replace(/\r\n/g, '\n');
    while ((sepIndex = this.buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = this.buffer.slice(0, sepIndex);
      this.buffer = this.buffer.slice(sepIndex + 2);
      const parsed = parseEventBlock(rawEvent);
      if (parsed) messages.push(parsed);
    }
    return messages;
  }

  /** Flush any trailing event not terminated by a blank line. */
  flush(): SSEMessage[] {
    const rest = this.buffer.trim();
    this.buffer = '';
    if (!rest) return [];
    const parsed = parseEventBlock(rest);
    return parsed ? [parsed] : [];
  }
}

function parseEventBlock(block: string): SSEMessage | null {
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }

  if (dataLines.length === 0 && event === undefined) return null;
  return event !== undefined
    ? { event, data: dataLines.join('\n') }
    : { data: dataLines.join('\n') };
}

/** Serialize an OpenAI-style SSE chunk (`data: <json>\n\n`). */
export function serializeData(data: string): string {
  return `data: ${data}\n\n`;
}

export const SSE_DONE = 'data: [DONE]\n\n';
