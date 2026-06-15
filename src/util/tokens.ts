// Rough token estimation used only as a fallback when the upstream does not
// report usage. This is intentionally crude (~4 chars/token heuristic).

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateTokensFromParts(parts: string[]): number {
  return parts.reduce((sum, p) => sum + estimateTokens(p), 0);
}
