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
      name: undefined,
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

  test('parses and trims the config display name', () => {
    expect(parseClientApiKeyItem({ 'api-key': 'sk-a', name: '  Alice  ' }).name).toBe('Alice');
    expect(parseClientApiKeyItem({ 'api-key': 'sk-a', name: '   ' }).name).toBeUndefined();
    expect(parseClientApiKeyItem({ 'api-key': 'sk-a', name: 42 }).name).toBeUndefined();
  });

  test('serializes a name-only key as a mapping entry', () => {
    expect(serializeClientApiKeyItem({ apiKey: 'sk-a', name: ' Alice ' })).toEqual({
      'api-key': 'sk-a',
      name: 'Alice',
    });
    expect(serializeClientApiKeyItem({ apiKey: 'sk-a', name: '  ' })).toBe('sk-a');
  });

  test('keeps the name next to model rules', () => {
    expect(
      serializeClientApiKeyItem({ apiKey: 'sk-a', name: 'CI', models: ['gpt-*'] })
    ).toEqual({ 'api-key': 'sk-a', name: 'CI', models: ['gpt-*'] });
  });
});
