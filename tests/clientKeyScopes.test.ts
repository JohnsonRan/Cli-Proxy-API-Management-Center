import { afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { apiClient } from '@/services/api/client';
import { keyScopesApi, parseClientKeyScope } from '@/services/api/keyScopes';
import { ClientKeyScopesCard } from '@/pages/ClientKeyScopesCard';
import {
  effectiveKeyScopeProviders,
  isOptionPick,
  KEY_SCOPE_BUILTIN_PROVIDERS,
  normalizeKeyScopeProvider,
  resolveKeyScope,
  validateKeyScopes,
} from '@/utils/keyScope';
import en from '@/i18n/locales/en.json';

const originalGet = apiClient.get;
const originalPut = apiClient.put;
const originalDelete = apiClient.delete;
afterEach(() => {
  apiClient.get = originalGet;
  apiClient.put = originalPut;
  apiClient.delete = originalDelete;
});

const scopes = [
  { keyPrefix: 'sk-', providers: ['gemini'] },
  { keyPrefix: 'sk-claude-', providers: ['claude'] },
  { keyPrefix: 'sk-claude-team-', providers: ['claude', 'codex'] },
];

describe('client key provider scopes', () => {
  test('the longest matching prefix wins, like the backend', () => {
    expect(resolveKeyScope('sk-claude-team-1', scopes)?.index).toBe(2);
    expect(resolveKeyScope('sk-claude-x', scopes)?.index).toBe(1);
    expect(resolveKeyScope('sk-other', scopes)?.index).toBe(0);
    expect(resolveKeyScope('pk-none', scopes)).toBeNull();
    expect(resolveKeyScope('', scopes)).toBeNull();
    // A full key is also a valid prefix.
    expect(resolveKeyScope('exact', [{ keyPrefix: 'exact', providers: ['xai'] }])?.index).toBe(0);
  });

  test('rules without a prefix or providers are skipped instead of locking keys out', () => {
    const broken = [
      { keyPrefix: 'sk-claude-team-', providers: [] },
      { keyPrefix: '', providers: ['codex'] },
      { keyPrefix: 'sk-claude-', providers: ['claude'] },
    ];
    expect(resolveKeyScope('sk-claude-team-1', broken)?.index).toBe(2);
    expect(validateKeyScopes(broken)).toEqual(['providers_required', 'prefix_required', undefined]);
  });

  test('equal prefixes keep the first rule and flag the later duplicate', () => {
    const twins = [
      { keyPrefix: 'sk-a', providers: ['claude'] },
      { keyPrefix: 'sk-a', providers: ['codex'] },
    ];
    expect(resolveKeyScope('sk-a1', twins)?.index).toBe(0);
    expect(validateKeyScopes(twins)).toEqual([undefined, 'prefix_duplicate']);
  });

  test('provider aliases resolve to the backend provider keys', () => {
    expect(
      ['Anthropic', 'openai', 'chatgpt', 'muse', 'grok'].map(normalizeKeyScopeProvider)
    ).toEqual(['claude', 'codex', 'codex', 'meta', 'xai']);
    expect(normalizeKeyScopeProvider(' my-compat ')).toBe('my-compat');
  });

  test('reads, writes and clears client.key-scopes through the generic v8 config path', async () => {
    const calls: string[] = [];
    apiClient.get = (async (url: string) => {
      calls.push(`GET ${url}`);
      return [{ 'key-prefix': ' sk-a ', providers: ['claude', ' ', 'codex'] }, 'junk'];
    }) as typeof apiClient.get;
    let body: unknown;
    apiClient.put = (async (url: string, data: unknown) => {
      calls.push(`PUT ${url}`);
      body = data;
    }) as typeof apiClient.put;
    apiClient.delete = (async (url: string) => {
      calls.push(`DELETE ${url}`);
    }) as typeof apiClient.delete;

    expect(await keyScopesApi.list()).toEqual([
      { keyPrefix: 'sk-a', providers: ['claude', 'codex'] },
    ]);
    await keyScopesApi.replace([{ keyPrefix: ' sk-b ', providers: ['xai '] }], false, () => {});
    expect(body).toEqual([{ 'key-prefix': 'sk-b', providers: ['xai'] }]);
    await keyScopesApi.replace([], false, () => {});
    await keyScopesApi.replace([], true, () => {});
    expect(calls).toEqual([
      'GET /config/client/key-scopes',
      'PUT /config/client/key-scopes',
      'DELETE /config/client/key-scopes',
    ]);
    expect(parseClientKeyScope(null)).toBeNull();
  });

  test('clearing an already-removed list succeeds; other delete errors still surface', async () => {
    apiClient.delete = (async () => {
      throw Object.assign(new Error('not found'), { status: 404, apiCode: 'not_found' });
    }) as typeof apiClient.delete;
    await keyScopesApi.replace([], false, () => {});
    apiClient.delete = (async () => {
      throw Object.assign(new Error('boom'), { status: 500 });
    }) as typeof apiClient.delete;
    await expect(keyScopesApi.replace([], false, () => {})).rejects.toThrow('boom');
  });

  test('a write after a connection switch is refused before any request', async () => {
    let requests = 0;
    apiClient.put = (async () => {
      requests += 1;
    }) as typeof apiClient.put;
    const switched = () => {
      throw new DOMException('The management connection changed.', 'AbortError');
    };
    await expect(
      keyScopesApi.replace([{ keyPrefix: 'sk-a', providers: ['claude'] }], false, switched)
    ).rejects.toThrow('connection changed');
    expect(requests).toBe(0);
  });

  test('suggestions use the provider keys core registers credentials under', () => {
    // Interactions API keys register as gemini-interactions, not "interactions".
    expect(KEY_SCOPE_BUILTIN_PROVIDERS).toContain('gemini-interactions');
    expect(KEY_SCOPE_BUILTIN_PROVIDERS).not.toContain('interactions' as never);
    expect(effectiveKeyScopeProviders(['openai', 'codex', 'Anthropic', ' '])).toEqual([
      'codex',
      'claude',
    ]);
  });

  test('only a picked datalist option commits a provider while typing', () => {
    // Typing "codex" on the way to "codex-relay" must not split the name into chips.
    const input = (inputType: string) => Object.assign(new Event('input'), { inputType });
    expect(isOptionPick(input('insertText'))).toBe(false);
    expect(isOptionPick(input('deleteContentBackward'))).toBe(false);
    expect(isOptionPick(input('insertReplacementText'))).toBe(true);
    expect(isOptionPick(new Event('input'))).toBe(true);
  });

  test('a missing key-scopes field reads as no rules', async () => {
    apiClient.get = (async () => {
      throw Object.assign(new Error('not found'), { status: 404, apiCode: 'not_found' });
    }) as typeof apiClient.get;
    expect(await keyScopesApi.list()).toEqual([]);
  });

  test('the editor renders labelled rows, removable chips and provider suggestions', () => {
    const translations = i18n.cloneInstance({ lng: 'en' });
    const render = (value: typeof scopes) =>
      renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n: translations },
          createElement(ClientKeyScopesCard, {
            scopes: value,
            providerSuggestions: ['claude', 'my-compat'],
            loading: false,
            disabled: false,
            onSave: async () => true,
          })
        )
      );
    const markup = render(scopes);
    expect(markup).toContain('value="sk-claude-team-"');
    expect(markup).toContain('aria-label="Remove codex"');
    expect(markup).toContain('<option value="my-compat">');
    const inputs = markup.match(/<input\b[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(6);
    for (const input of inputs) {
      const id = input.match(/\bid="([^"]+)"/)?.[1];
      expect(markup).toContain(`for="${id}"`);
    }
    expect(render([])).toContain(en.api_keys_page.scopes.empty);
  });
});
