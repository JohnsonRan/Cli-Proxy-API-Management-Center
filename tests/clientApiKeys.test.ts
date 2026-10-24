import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import {
  apiKeysApi,
  normalizeClientModelPatterns,
  parseClientApiKeyItem,
  parseGlobalClientModelRules,
  serializeClientApiKeyItem,
  serializeClientModelPatterns,
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
    expect(serializeClientApiKeyItem({ apiKey: 'sk-a', name: 'CI', models: ['gpt-*'] })).toEqual({
      'api-key': 'sk-a',
      name: 'CI',
      models: ['gpt-*'],
    });
  });
});

describe('global client model rules API', () => {
  afterEach(() => {
    mock.restore();
  });

  test('normalizes and serializes global pattern lists', () => {
    expect(
      normalizeClientModelPatterns(['  gpt-4o  ', '', 'GPT-4O', 'claude-*', 42, null])
    ).toEqual(['gpt-4o', 'claude-*']);
    expect(normalizeClientModelPatterns('not-an-array')).toEqual([]);
    expect(serializeClientModelPatterns(['  gpt-4o ', ''])).toEqual(['gpt-4o']);
    expect(serializeClientModelPatterns(['  ', ''])).toBeUndefined();
    expect(serializeClientModelPatterns(undefined)).toBeUndefined();
    expect(parseGlobalClientModelRules([' gpt-* '], [' *-preview ', ''])).toEqual({
      models: ['gpt-*'],
      excludedModels: ['*-preview'],
    });
  });

  test('reads global rules from v8 access paths and defaults missing fields to empty', async () => {
    const notFound = Object.assign(new Error('not found'), {
      status: 404,
      apiCode: 'not_found',
    });
    const get = spyOn(apiClient, 'get').mockImplementation(async (path: string) => {
      if (path === '/config/access/models') return [' gpt-4o* ', 'claude-*'] as never;
      if (path === '/config/access/excluded-models') throw notFound;
      throw new Error(`unexpected path: ${path}`);
    });

    const rules = await apiKeysApi.getGlobalModelRules();
    expect(rules).toEqual({ models: ['gpt-4o*', 'claude-*'], excludedModels: [] });
    expect(get).toHaveBeenCalledTimes(2);
  });

  test('writes non-empty lists with PUT and clears emptied lists with DELETE', async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    spyOn(apiClient, 'put').mockImplementation(async (path: string, body?: unknown) => {
      calls.push({ method: 'PUT', path, body });
      return { status: 'ok' } as never;
    });
    spyOn(apiClient, 'delete').mockImplementation(async (path: string) => {
      calls.push({ method: 'DELETE', path });
      return { status: 'ok' } as never;
    });

    const committedSnapshots: string[][] = [];
    const saved = await apiKeysApi.replaceGlobalModelRules(
      { models: [' gpt-4o ', 'claude-*'], excludedModels: [] },
      { models: ['gpt-4o'], excludedModels: ['*-preview'] },
      () => {},
      (models) => committedSnapshots.push(models)
    );

    expect(saved).toEqual({ models: ['gpt-4o', 'claude-*'], excludedModels: [] });
    expect(committedSnapshots).toEqual([['gpt-4o', 'claude-*']]);
    expect(calls).toEqual([
      { method: 'PUT', path: '/config/access/models', body: ['gpt-4o', 'claude-*'] },
      { method: 'DELETE', path: '/config/access/excluded-models' },
    ]);
  });

  test('skips unchanged lists and ignores 404 not_found when deleting', async () => {
    const notFound = Object.assign(new Error('not found'), {
      status: 404,
      apiCode: 'not_found',
    });
    const put = spyOn(apiClient, 'put').mockResolvedValue({ status: 'ok' } as never);
    const del = spyOn(apiClient, 'delete').mockRejectedValue(notFound);

    const saved = await apiKeysApi.replaceGlobalModelRules(
      { models: [], excludedModels: ['*-preview'] },
      { models: ['gpt-4o'], excludedModels: ['*-preview'] }
    );

    expect(saved).toEqual({ models: [], excludedModels: ['*-preview'] });
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('/config/access/models');
    expect(put).not.toHaveBeenCalled();
  });
});
