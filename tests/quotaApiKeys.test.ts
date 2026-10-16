import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import en from '@/i18n/locales/en.json';
import { ClientKeyQuotaCredentialsField } from '@/pages/ClientKeyQuotaCredentialsField';
import { buildQuotaCredentialOptions } from '@/utils/quotaCredentials';
import {
  parseQuotaApiKeyEntry,
  quotaApiKeysApi,
  quotaCredentialsForKey,
  sameQuotaApiKeys,
  serializeQuotaApiKeyEntry,
  withQuotaCredentials,
  type QuotaApiKeyEntry,
} from '@/services/api/quotaApiKeys';
import type { AuthFileItem } from '@/types/authFile';
import type { ClientApiKeyItem } from '@/services/api/apiKeys';
import { apiClient } from '@/services/api/client';
import { useConfigStore } from '@/stores/useConfigStore';

const originalPatch = apiClient.patch;
afterEach(() => {
  apiClient.patch = originalPatch;
});

const entries: QuotaApiKeyEntry[] = [
  { apiKey: 'sk-a', credentials: ['codex.json'] },
  { apiKey: 'sk-b', credentials: ['claude.json'] },
];

describe('observability.quota-api.keys', () => {
  test('parses, trims and dedupes entries and drops ones without a key', () => {
    expect(
      parseQuotaApiKeyEntry({ 'api-key': ' sk-a ', credentials: [' a.json', 'a.json', '', 2] })
    ).toEqual({ apiKey: 'sk-a', credentials: ['a.json', '2'] });
    expect(parseQuotaApiKeyEntry({ credentials: ['a.json'] })).toBeNull();
    expect(parseQuotaApiKeyEntry('sk-a')).toBeNull();
    expect(
      serializeQuotaApiKeyEntry({ apiKey: ' sk-a', credentials: ['a.json', ' a.json'] })
    ).toEqual({ 'api-key': 'sk-a', credentials: ['a.json'] });
  });

  test('merges repeated keys like core does', () => {
    const repeated = [...entries, { apiKey: 'sk-a', credentials: ['xai.json', 'codex.json'] }];
    expect(quotaCredentialsForKey(repeated, ' sk-a ')).toEqual(['codex.json', 'xai.json']);
    expect(quotaCredentialsForKey(repeated, 'sk-c')).toEqual([]);
  });

  test('an unchanged save keeps the list identical', () => {
    const next = withQuotaCredentials(entries, 'sk-a', 'sk-a', ['codex.json']);
    expect(next).toEqual(entries);
    expect(sameQuotaApiKeys(entries, next)).toBe(true);
  });

  test('a renamed key carries its selection and the old value keeps nothing', () => {
    expect(withQuotaCredentials(entries, 'sk-a', 'sk-a2', ['codex.json', 'xai.json'])).toEqual([
      { apiKey: 'sk-a2', credentials: ['codex.json', 'xai.json'] },
      { apiKey: 'sk-b', credentials: ['claude.json'] },
    ]);
  });

  test('clearing the selection or deleting the key removes the entry', () => {
    expect(withQuotaCredentials(entries, 'sk-b', 'sk-b', [])).toEqual([entries[0]]);
    expect(withQuotaCredentials(entries, null, 'sk-new', [])).toEqual(entries);
    expect(withQuotaCredentials(entries, null, 'sk-new', ['a.json'])).toEqual([
      ...entries,
      { apiKey: 'sk-new', credentials: ['a.json'] },
    ]);
  });
});

describe('quota credential options', () => {
  const files = [
    {
      id: 'codex-b.json',
      name: 'codex-b.json',
      provider: 'codex',
      note: 'work',
      account_type: 'oauth',
    },
    {
      id: 'claude-a.json',
      name: 'claude-a.json',
      type: 'claude',
      disabled: true,
      account_type: 'oauth',
    },
    { id: 'gemini.json', name: 'gemini.json', provider: 'gemini', account_type: 'oauth' },
    { name: 'grok.json', provider: 'Grok', account_type: 'oauth' },
    // Config API keys are listed with the same providers, but core probes only OAuth.
    {
      id: 'claude:apikey:1',
      name: 'claude:apikey:1',
      provider: 'claude',
      account_type: 'api_key',
      runtime_only: true,
    },
    { id: 'codex-plain.json', name: 'codex-plain.json', provider: 'codex' },
  ] as AuthFileItem[];

  test('lists OAuth credentials of supported providers by core ID and keeps vanished IDs', () => {
    const options = buildQuotaCredentialOptions(files, ['gone.json', 'codex-b.json']);
    expect(options.map((option) => [option.id, option.label, option.provider])).toEqual([
      ['claude-a.json', 'claude-a.json', 'claude'],
      ['codex-b.json', 'work · codex-b.json', 'codex'],
      ['grok.json', 'grok.json', 'grok'],
      ['gone.json', 'gone.json', ''],
    ]);
    expect(options[0].disabled).toBe(true);
    expect(options[3].missing).toBe(true);
  });

  test('saved IDs are not shown as removed before the credential list loads', () => {
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n: i18n.cloneInstance({ lng: 'en' }) },
        createElement(ClientKeyQuotaCredentialsField, {
          value: ['codex-b.json'],
          onChange: () => {},
          disabled: false,
        })
      )
    );
    expect(markup).toContain(en.api_keys_page.quota_credentials.loading);
    expect(markup).not.toContain(en.api_keys_page.quota_credentials.missing);
    expect(markup).not.toContain('codex-b.json');
  });
});

describe('atomic client key and quota writes', () => {
  test('sends both serialized lists in one root PATCH, including explicit empty lists', async () => {
    const calls: unknown[][] = [];
    apiClient.patch = (async (...args: unknown[]) => {
      calls.push(args);
    }) as typeof apiClient.patch;
    const items = [
      { apiKey: 'sk-a' },
      { apiKey: 'sk-b', models: [' model-a '], excludedModels: [' model-b '] },
    ];
    await quotaApiKeysApi.replaceClientKeys(
      items,
      [{ apiKey: ' sk-a ', credentials: [' codex.json ', 'codex.json'] }],
      () => {}
    );
    expect(calls).toEqual([
      [
        '/config',
        {
          access: {
            'api-keys': [
              'sk-a',
              {
                'api-key': 'sk-b',
                models: ['model-a'],
                'excluded-models': ['model-b'],
              },
            ],
          },
          observability: {
            'quota-api': { keys: [{ 'api-key': 'sk-a', credentials: ['codex.json'] }] },
          },
        },
      ],
    ]);
    await quotaApiKeysApi.replaceClientKeys([], [], () => {});
    expect(calls[1]).toEqual([
      '/config',
      {
        access: { 'api-keys': [] },
        observability: { 'quota-api': { keys: [] } },
      },
    ]);
    await quotaApiKeysApi.replaceClientKeys(items, undefined, () => {});
    expect(calls[2]).toEqual(['/config', { access: (calls[0][1] as { access: unknown }).access }]);
  });

  test('checks the captured connection before sending and after awaiting the write', async () => {
    let calls = 0;
    apiClient.patch = (async () => {
      calls++;
    }) as typeof apiClient.patch;
    const changed = () => {
      throw new Error('connection changed');
    };
    await expect(quotaApiKeysApi.replaceClientKeys([], [], changed)).rejects.toThrow(
      'connection changed'
    );
    expect(calls).toBe(0);
    let connected = true;
    apiClient.patch = (async () => {
      connected = false;
    }) as typeof apiClient.patch;
    await expect(
      quotaApiKeysApi.replaceClientKeys([], [], () => {
        if (!connected) changed();
      })
    ).rejects.toThrow('connection changed');
  });
});

// Exercise the real callbacks without introducing a browser DOM test dependency.
const pageSource = readFileSync('src/pages/ApiKeysPage.tsx', 'utf8');
function callbackSource(action: string) {
  const source = ts.createSourceFile('ApiKeysPage.tsx', pageSource, ts.ScriptTarget.Latest, true);
  let callback: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === action) {
      const call = node.initializer;
      if (call && ts.isCallExpression(call)) callback = call.arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!callback) throw new Error(`Callback not found: ${action}`);
  return ts.transpileModule(`return (${callback.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function mutationHarness(
  action: 'handleSave' | 'handleConfirmDelete',
  failure: 'write' | 'refresh' | 'connection-write' | 'connection-refresh'
) {
  let items: ClientApiKeyItem[] = [{ apiKey: 'sk-a' }, { apiKey: 'sk-b' }];
  let quota = structuredClone(entries);
  let fail = true;
  let connected = true;
  let closed = false;
  let errors = 0;
  let cacheClears = 0;
  let refreshes = 0;
  const committedKeys: unknown[] = [];
  const notifications: { message: string; kind: string }[] = [];
  const requests: unknown[] = [];
  apiClient.patch = (async (_url: string, body: unknown) => {
    requests.push(body);
    if (fail && failure === 'write') throw new Error('write failed');
    if (failure === 'connection-write') connected = false;
  }) as typeof apiClient.patch;
  return {
    async run(nextAction = action, credentials = ['codex.json']) {
      const env = {
        useCallback: (fn: unknown) => fn,
        keyInput: 'sk-c',
        nameInput: '',
        allowedModels: [],
        excludedModels: [],
        editingIndex: 0,
        targetDeleteIndex: 0,
        apiBase: 'http://fixture.invalid',
        apiKeyItems: items,
        quotaKeys: quota,
        quotaCredentials: credentials,
        connectionGuardRef: {
          current: () => {
            if (!connected) throw new Error('connection changed');
          },
        },
        quotaApiKeysApi,
        sameQuotaApiKeys,
        withQuotaCredentials,
        isValidApiKeyCharset: () => true,
        saveApiKeyName: () => true,
        readApiKeyNames: () => ({}),
        setSaving: () => {},
        setNames: () => {},
        setApiKeyItems: (next: ClientApiKeyItem[]) => {
          items = next;
        },
        setQuotaKeys: (next: QuotaApiKeyEntry[]) => {
          quota = next;
        },
        closeModal: () => {
          closed = true;
        },
        closeDeleteModal: () => {
          closed = true;
        },
        setFormError: () => {
          errors++;
        },
        showNotification: (message: string, kind: string) => {
          notifications.push({ message, kind });
          if (kind === 'error') errors++;
        },
        getErrorMessage: (error: Error) => error.message,
        t: (key: string) => key,
        updateConfigValue: (section: string, value: unknown) => {
          expect(section).toBe('api-keys');
          committedKeys.push(value);
          cacheClears++;
        },
        fetchConfig: async () => {
          refreshes++;
          expect(cacheClears).toBe(refreshes);
          expect(closed).toBe(true);
          if (failure === 'connection-refresh') connected = false;
          if (fail && failure === 'refresh') throw new Error('refresh failed');
        },
      };
      const refreshConfigAfterSave = new Function(
        ...Object.keys(env),
        callbackSource('refreshConfigAfterSave')
      )(...Object.values(env));
      await new Function(...Object.keys(env), 'refreshConfigAfterSave', callbackSource(nextAction))(
        ...Object.values(env),
        refreshConfigAfterSave
      )();
    },
    retry() {
      fail = false;
    },
    requests,
    notifications,
    committedKeys,
    get items() {
      return items;
    },
    get quota() {
      return quota;
    },
    get closed() {
      return closed;
    },
    get errors() {
      return errors;
    },
    get cacheClears() {
      return cacheClears;
    },
  };
}

test('delete retry after write failure never deletes the next key', async () => {
  const h = mutationHarness('handleConfirmDelete', 'write');
  await h.run();
  expect(h.errors).toBe(1);
  expect(h.items.map((item) => item.apiKey)).toEqual(['sk-a', 'sk-b']);
  expect(h.quota).toEqual(entries);
  expect(h.closed).toBe(false);
  expect(h.cacheClears).toBe(0);
  h.retry();
  await h.run();
  expect(h.requests).toHaveLength(2);
  expect(h.requests[1]).toEqual(h.requests[0]);
  expect(h.items).toEqual([{ apiKey: 'sk-b' }]);
  expect(h.quota).toEqual([entries[1]]);
  expect(h.closed).toBe(true);
});

test("rename retry after write failure removes the old key's quota grants", async () => {
  const h = mutationHarness('handleSave', 'write');
  await h.run();
  expect(h.errors).toBe(1);
  expect(h.items.map((item) => item.apiKey)).toEqual(['sk-a', 'sk-b']);
  expect(h.quota).toEqual(entries);
  expect(h.closed).toBe(false);
  expect(h.cacheClears).toBe(0);
  h.retry();
  await h.run();
  expect(h.requests).toHaveLength(2);
  expect(h.requests[1]).toEqual(h.requests[0]);
  expect(h.items.map((item) => item.apiKey)).toEqual(['sk-c', 'sk-b']);
  expect(h.quota).toEqual([{ apiKey: 'sk-c', credentials: ['codex.json'] }, entries[1]]);
  expect(h.closed).toBe(true);
});

for (const action of ['handleSave', 'handleConfirmDelete'] as const) {
  test(`${action} commits local state and closes dialog despite failed refresh`, async () => {
    const h = mutationHarness(action, 'refresh');
    await h.run();
    expect(h.requests).toHaveLength(1);
    expect(h.errors).toBe(0);
    expect(h.closed).toBe(true);
    expect(h.cacheClears).toBe(1);
    expect(h.committedKeys).toEqual([action === 'handleSave' ? ['sk-c', 'sk-b'] : ['sk-b']]);
    expect(h.items.map((item) => item.apiKey)).toEqual(
      action === 'handleSave' ? ['sk-c', 'sk-b'] : ['sk-b']
    );
    expect(h.quota).toEqual(
      action === 'handleSave'
        ? [{ apiKey: 'sk-c', credentials: ['codex.json'] }, entries[1]]
        : [entries[1]]
    );
    expect(h.notifications).toEqual([
      {
        kind: 'warning',
        message: 'config_management.save_success. notification.refresh_failed: refresh failed',
      },
    ]);
  });

  test(`${action} applies nothing if connection switches during write`, async () => {
    const h = mutationHarness(action, 'connection-write');
    await h.run();
    expect(h.items.map((item) => item.apiKey)).toEqual(['sk-a', 'sk-b']);
    expect(h.quota).toEqual(entries);
    expect(h.closed).toBe(false);
    expect(h.cacheClears).toBe(0);
  });

  test(`${action} suppresses old-session notifications after refresh switches connection`, async () => {
    const h = mutationHarness(action, 'connection-refresh');
    await h.run();
    expect(h.errors).toBe(0);
    expect(h.closed).toBe(true);
    expect(h.notifications).toEqual([]);
  });
}

test('next mutation after failed post-delete refresh cannot resurrect the deleted key', async () => {
  const h = mutationHarness('handleConfirmDelete', 'refresh');
  await h.run();
  expect(h.closed).toBe(true);
  h.retry();
  await h.run('handleSave', ['claude.json']);
  expect(h.requests).toHaveLength(2);
  expect(h.requests[1]).toEqual({
    access: { 'api-keys': ['sk-c'] },
    observability: {
      'quota-api': { keys: [{ 'api-key': 'sk-c', credentials: ['claude.json'] }] },
    },
  });
  expect(h.items.map((item) => item.apiKey)).toEqual(['sk-c']);
  expect(h.quota).toEqual([{ apiKey: 'sk-c', credentials: ['claude.json'] }]);
});

test('committing client keys keeps the rest of the config snapshot and invalidates the cache', () => {
  const openaiCompatibility = [{ name: 'custom-relay' }] as never;
  useConfigStore.setState({ config: { apiKeys: ['sk-a', 'sk-b'], openaiCompatibility } });
  useConfigStore.getState().updateConfigValue('api-keys', ['sk-b']);
  const { config, isCacheValid } = useConfigStore.getState();
  expect(config?.apiKeys).toEqual(['sk-b']);
  expect(config?.openaiCompatibility).toBe(openaiCompatibility);
  expect(isCacheValid()).toBe(false);
  useConfigStore.setState({ config: null });
});
