import { afterEach, expect, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import { providersApi } from '@/services/api/providers';
import { normalizeProviderGroups } from '@/services/api/transformers';
import type { OpenAIProviderConfig } from '@/types';

const originalGet = apiClient.get;
const originalPut = apiClient.put;
afterEach(() => {
  apiClient.get = originalGet;
  apiClient.put = originalPut;
});

function backend(group: Record<string, unknown>) {
  let stored = structuredClone(group);
  apiClient.get = (async () => ({
    'api-keys': { 'openai-compatibility': [stored] },
  })) as typeof apiClient.get;
  apiClient.put = (async (_path: string, value: Record<string, unknown>[]) => {
    stored = structuredClone(value[0]);
  }) as typeof apiClient.put;
  return () => stored;
}

test('OpenAI-compatible embedding and rerank flags are saved and can be cleared', async () => {
  const stored = backend({
    name: 'fixture',
    'base-url': 'https://example.invalid/v1',
    keys: [{ 'api-key': 'fixture-key' }],
    models: [{ name: 'BAAI/bge-m3' }, { name: 'BAAI/bge-reranker-v2-m3' }],
  });
  let config = normalizeProviderGroups([stored()], true)[0] as OpenAIProviderConfig;
  await providersApi.updateOpenAIProvider(config.name, 0, {
    ...config,
    models: [
      { ...config.models![0], embedding: true },
      { ...config.models![1], rerank: true },
    ],
  });
  expect(stored().models).toEqual([
    { name: 'BAAI/bge-m3', embedding: true },
    { name: 'BAAI/bge-reranker-v2-m3', rerank: true },
  ]);

  config = normalizeProviderGroups([stored()], true)[0] as OpenAIProviderConfig;
  expect(config.models![0].embedding).toBe(true);
  expect(config.models![1].rerank).toBe(true);
  await providersApi.updateOpenAIProvider(config.name, 0, {
    ...config,
    models: [
      { ...config.models![0], embedding: false },
      { ...config.models![1], rerank: false },
    ],
  });
  expect(stored().models).toEqual([{ name: 'BAAI/bge-m3' }, { name: 'BAAI/bge-reranker-v2-m3' }]);
});
