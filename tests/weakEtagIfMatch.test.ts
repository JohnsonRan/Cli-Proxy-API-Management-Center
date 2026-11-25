import { afterEach, describe, expect, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import { normalizeConfigETag, providersApi } from '@/services/api/providers';

const { getRaw, put, captureConnection } = apiClient;
afterEach(() => Object.assign(apiClient, { getRaw, put, captureConnection }));

describe('normalizeConfigETag', () => {
  test('unwraps weak quoted ETags while preserving strong ETags', () => {
    expect(normalizeConfigETag('"abc123"')).toBe('"abc123"');
    expect(normalizeConfigETag('W/"abc123"')).toBe('"abc123"');
    expect(normalizeConfigETag('w/"abc123"')).toBe('"abc123"');
    expect(normalizeConfigETag('  W/"abc123"  ')).toBe('"abc123"');
  });

  test('does not rewrite wildcards or malformed entity tags and rejects blank inputs', () => {
    expect(normalizeConfigETag('W/*')).toBe('W/*');
    expect(normalizeConfigETag('W/"a""b"')).toBe('W/"a""b"');
    expect(normalizeConfigETag('')).toBeNull();
    expect(normalizeConfigETag('   ')).toBeNull();
    expect(normalizeConfigETag(undefined)).toBeNull();
    expect(normalizeConfigETag(null)).toBeNull();
  });
});

describe('mutateNativeGroups weak ETag handling', () => {
  test('sends strong If-Match when GET /config returns a compression-weakened ETag', async () => {
    apiClient.captureConnection = () => apiClient;
    const initial = [{ name: 'empty-old', keys: [] }];
    let groups = structuredClone(initial);
    const seenIfMatch: Array<string | undefined> = [];

    apiClient.getRaw = (async (url) => {
      expect(url).toBe('/config');
      return {
        data: { 'api-keys': { codex: structuredClone(groups) } },
        headers: { etag: 'W/"sha256-config-hash"' },
      };
    }) as typeof getRaw;

    apiClient.put = (async (url, value, options) => {
      expect(url).toBe('/config/api-keys/codex');
      seenIfMatch.push((options?.headers as Record<string, string> | undefined)?.['If-Match']);
      groups = structuredClone(value as typeof groups);
    }) as typeof put;

    await providersApi.deleteNativeGroup('codex', {
      groupIndex: 0,
      group: initial[0],
      groups: initial,
    });
    expect(groups).toEqual([]);

    await providersApi.createNativeGroup('codex', { name: 'fresh' });
    expect(groups).toEqual([{ name: 'fresh', keys: [] }]);

    expect(seenIfMatch).toEqual(['"sha256-config-hash"', '"sha256-config-hash"']);
  });

  test('reads capitalized ETag header key when present', async () => {
    apiClient.captureConnection = () => apiClient;
    let captured: string | undefined;

    apiClient.getRaw = (async () => ({
      data: { 'api-keys': { gemini: [] } },
      headers: { ETag: 'W/"upper-etag"' },
    })) as typeof getRaw;

    apiClient.put = (async (_url, _value, options) => {
      captured = (options?.headers as Record<string, string> | undefined)?.['If-Match'];
    }) as typeof put;

    await providersApi.createNativeGroup('gemini', { name: 'g1' });
    expect(captured).toBe('"upper-etag"');
  });

  test('rejects missing or whitespace-only ETag before writing', async () => {
    apiClient.captureConnection = () => apiClient;
    let writes = 0;

    apiClient.getRaw = (async () => ({
      data: { 'api-keys': { claude: [] } },
      headers: { etag: '   ' },
    })) as typeof getRaw;

    apiClient.put = (async () => {
      writes++;
    }) as typeof put;

    await expect(providersApi.createNativeGroup('claude', { name: 'c1' })).rejects.toThrow();
    expect(writes).toBe(0);
  });
});
