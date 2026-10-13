import { describe, expect, test } from 'bun:test';
import {
  parseClientApiKeyItem,
  serializeClientApiKeyItem,
  ClientApiKeyItem,
} from '../src/services/api/apiKeys';

describe('client API keys model permissions', () => {
  test('parses bare string key', () => {
    const item = parseClientApiKeyItem('  sk-test-key  ');
    expect(item).toEqual({ apiKey: 'sk-test-key' });
  });

  test('parses object key with models and excluded-models', () => {
    const raw = {
      'api-key': 'sk-custom',
      models: ['gpt-4o', 'gpt-4o-mini'],
      'excluded-models': ['*-preview'],
    };
    const item = parseClientApiKeyItem(raw);
    expect(item).toEqual({
      apiKey: 'sk-custom',
      models: ['gpt-4o', 'gpt-4o-mini'],
      allowedModels: undefined,
      excludedModels: ['*-preview'],
    });
  });

  test('serializes bare key when no models configured', () => {
    const item: ClientApiKeyItem = { apiKey: 'sk-bare' };
    const serialized = serializeClientApiKeyItem(item);
    expect(serialized).toBe('sk-bare');
  });

  test('serializes object when models or exclusions configured', () => {
    const item: ClientApiKeyItem = {
      apiKey: 'sk-custom',
      models: ['gpt-4o', 'claude-*'],
      excludedModels: ['*-preview'],
    };
    const serialized = serializeClientApiKeyItem(item);
    expect(serialized).toEqual({
      'api-key': 'sk-custom',
      models: ['gpt-4o', 'claude-*'],
      'excluded-models': ['*-preview'],
    });
  });
});
