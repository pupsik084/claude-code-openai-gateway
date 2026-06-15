// Default OpenAI-name -> Anthropic-model mapping. Override via the MODEL_MAP
// env var (JSON). Resolution: exact match -> alias map -> prefix rule -> default.

export const DEFAULT_MODEL_MAP: Record<string, string> = {
  // OpenAI-like aliases so existing tooling "just works".
  'gpt-4o': 'claude-sonnet-4-6',
  'gpt-4o-mini': 'claude-haiku-4-5',
  'gpt-4-turbo': 'claude-sonnet-4-6',
  'gpt-4': 'claude-opus-4-6',
  'gpt-3.5-turbo': 'claude-haiku-4-5',
  // Direct Anthropic names — pass-through.
  'claude-opus-4-6': 'claude-opus-4-6',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-haiku-4-5': 'claude-haiku-4-5',
};

export interface ModelResolverOptions {
  defaultModel: string;
  overrides?: Record<string, string>;
}

export class ModelResolver {
  private readonly map: Record<string, string>;
  private readonly defaultModel: string;

  constructor(opts: ModelResolverOptions) {
    this.defaultModel = opts.defaultModel;
    this.map = { ...DEFAULT_MODEL_MAP, ...(opts.overrides ?? {}) };
  }

  /** Resolve a requested model name to an Anthropic model. Returns the target
   * and whether a fallback to the default was used. */
  resolve(requested: string | undefined): { model: string; fallback: boolean } {
    const name = (requested ?? '').trim();
    if (!name) return { model: this.defaultModel, fallback: true };

    // Exact match (alias or direct).
    const direct = this.map[name];
    if (direct) return { model: direct, fallback: false };

    // Pass-through: anything that already looks like a Claude model name.
    if (name.startsWith('claude-')) return { model: name, fallback: false };

    // Prefix rules for common OpenAI families.
    if (name.startsWith('gpt-4o-mini')) return { model: 'claude-haiku-4-5', fallback: false };
    if (name.startsWith('gpt-4o') || name.startsWith('gpt-4'))
      return { model: this.map['gpt-4o'] ?? this.defaultModel, fallback: false };
    if (name.startsWith('gpt-3.5')) return { model: 'claude-haiku-4-5', fallback: false };

    return { model: this.defaultModel, fallback: true };
  }

  /** Model ids advertised by GET /v1/models. */
  listIds(): string[] {
    return Array.from(new Set(Object.keys(this.map)));
  }
}
