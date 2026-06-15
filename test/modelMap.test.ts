import { describe, expect, it } from 'vitest';
import { ModelResolver } from '../src/models/modelMap.js';

describe('ModelResolver', () => {
  const resolver = new ModelResolver({ defaultModel: 'claude-sonnet-4-6' });

  it('maps known OpenAI aliases', () => {
    expect(resolver.resolve('gpt-4o')).toEqual({ model: 'claude-sonnet-4-6', fallback: false });
    expect(resolver.resolve('gpt-4o-mini')).toEqual({ model: 'claude-haiku-4-5', fallback: false });
    expect(resolver.resolve('gpt-4')).toEqual({ model: 'claude-opus-4-6', fallback: false });
  });

  it('passes through direct claude- names', () => {
    expect(resolver.resolve('claude-3-7-sonnet')).toEqual({
      model: 'claude-3-7-sonnet',
      fallback: false,
    });
  });

  it('uses prefix rules for unmapped gpt families', () => {
    expect(resolver.resolve('gpt-4o-2024-11-20').model).toBe('claude-sonnet-4-6');
    expect(resolver.resolve('gpt-3.5-turbo-0125').model).toBe('claude-haiku-4-5');
  });

  it('falls back to default for unknown/empty models', () => {
    expect(resolver.resolve('mistral-large')).toEqual({
      model: 'claude-sonnet-4-6',
      fallback: true,
    });
    expect(resolver.resolve(undefined)).toEqual({ model: 'claude-sonnet-4-6', fallback: true });
  });

  it('honors overrides from env-style map', () => {
    const overridden = new ModelResolver({
      defaultModel: 'claude-sonnet-4-6',
      overrides: { 'gpt-4o': 'claude-opus-4-6' },
    });
    expect(overridden.resolve('gpt-4o').model).toBe('claude-opus-4-6');
  });

  it('lists advertised model ids', () => {
    expect(resolver.listIds()).toContain('gpt-4o');
    expect(resolver.listIds()).toContain('claude-sonnet-4-6');
  });
});
