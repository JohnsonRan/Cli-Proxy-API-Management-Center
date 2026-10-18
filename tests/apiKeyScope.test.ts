import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_VISIBLE_MODEL_LIMIT,
  hasApiKeyModelRestrictions,
  summarizeApiKeyModelScope,
} from '@/utils/apiKeyScope';

describe('client API key model scope summary', () => {
  test('treats a key without rules as unrestricted', () => {
    const summary = summarizeApiKeyModelScope({});

    expect(summary.allowed).toEqual([]);
    expect(summary.excluded).toEqual([]);
    expect(summary.visibleAllowed).toEqual([]);
    expect(summary.hiddenAllowedCount).toBe(0);
    expect(hasApiKeyModelRestrictions({})).toBe(false);
  });

  test('caps the visible allow-list and counts the overflow', () => {
    const summary = summarizeApiKeyModelScope({
      models: ['a', 'b', 'c', 'd', 'e'],
    });

    expect(summary.visibleAllowed).toEqual(['a', 'b', 'c']);
    expect(summary.hiddenAllowedCount).toBe(2);
    expect(hasApiKeyModelRestrictions({ models: ['a'] })).toBe(true);
  });

  test('keeps exclusion rules visible even without an allow-list', () => {
    const summary = summarizeApiKeyModelScope({
      excludedModels: ['*-preview', 'o1-*'],
    });

    expect(summary.allowed).toEqual([]);
    expect(summary.excluded).toEqual(['*-preview', 'o1-*']);
    expect(summary.hiddenAllowedCount).toBe(0);
    expect(hasApiKeyModelRestrictions({ excludedModels: ['*-preview'] })).toBe(true);
  });

  test('falls back to the legacy allowedModels field and drops empty entries', () => {
    const summary = summarizeApiKeyModelScope({
      allowedModels: ['gpt-4o', '', 'claude-*'],
      excludedModels: [''],
    });

    expect(summary.allowed).toEqual(['gpt-4o', 'claude-*']);
    expect(summary.excluded).toEqual([]);
  });

  test('honours the default limit and a custom limit of zero', () => {
    const models = ['a', 'b', 'c', 'd'];

    expect(DEFAULT_VISIBLE_MODEL_LIMIT).toBe(3);
    expect(summarizeApiKeyModelScope({ models }).visibleAllowed).toHaveLength(3);
    expect(summarizeApiKeyModelScope({ models }, 0).visibleAllowed).toEqual([]);
  });

  test('accepts null input', () => {
    expect(summarizeApiKeyModelScope(null).visibleAllowed).toEqual([]);
    expect(hasApiKeyModelRestrictions(null)).toBe(false);
  });
});
