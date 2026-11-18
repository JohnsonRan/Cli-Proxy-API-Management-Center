import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { apiClient } from '@/services/api/client';
import { providersApi } from '@/services/api/providers';
import { normalizeProviderGroups } from '@/services/api/transformers';
import { openaiToResource } from '@/features/providers/adapters';
import { PROVIDER_DESCRIPTORS } from '@/features/providers/descriptors';
import type { ProviderBrand, ProviderEntryFormInput } from '@/features/providers/types';
import { buildOpenAIConfig } from '@/features/providers/useProviderWorkbench';
import type { OpenAIProviderConfig } from '@/types';

const originalGet = apiClient.get;
const originalPut = apiClient.put;
afterEach(() => {
  apiClient.get = originalGet;
  apiClient.put = originalPut;
});

function backend(initial: Record<string, unknown>[] = []) {
  let groups = structuredClone(initial);
  apiClient.get = (async () => ({
    'api-keys': { 'openai-compatibility': groups },
  })) as typeof apiClient.get;
  apiClient.put = (async (url: string, data: Record<string, unknown>[]) => {
    expect(url).toBe('/config/api-keys/openai-compatibility');
    groups = structuredClone(data);
  }) as typeof apiClient.put;
  return () => groups;
}

const load = (groups: Record<string, unknown>[]) =>
  normalizeProviderGroups(groups, true)[0] as OpenAIProviderConfig;

const formInput = (patch: Partial<ProviderEntryFormInput>): ProviderEntryFormInput => ({
  apiKey: '',
  name: 'fixture',
  baseUrl: 'https://example.invalid/v1',
  proxyUrl: '',
  prefix: '',
  disabled: false,
  models: [],
  headers: [],
  excludedModelsText: '',
  apiKeyEntries: [{ apiKey: 'fixture-key', proxyUrl: '' }],
  ...patch,
});

describe('OpenAI-compatible model auto-discovery', () => {
  test('creates a provider with discovery, exclusions and no explicit models', async () => {
    const groups = backend();
    await providersApi.createOpenAIProvider(
      buildOpenAIConfig(
        formInput({ autoDiscoverModels: true, excludedModelsText: '*-preview\nglm-4.*\n*' })
      )
    );
    expect(groups()[0]).toEqual({
      name: 'fixture',
      'base-url': 'https://example.invalid/v1',
      keys: [{ 'api-key': 'fixture-key' }],
      disabled: false,
      'auto-discover-models': true,
      // Unlike other brands, `*` is a plain "hide all" rule here: `disabled` is its own field.
      'excluded-models': ['*-preview', 'glm-4.*', '*'],
    });
    expect(groups()[0]).not.toHaveProperty('models');
    const config = load(groups());
    expect(config.autoDiscoverModels).toBe(true);
    expect(config.excludedModels).toEqual(['*-preview', 'glm-4.*', '*']);
  });

  test('turning discovery off and clearing exclusions removes both keys', async () => {
    const groups = backend([
      {
        name: 'fixture',
        'base-url': 'https://example.invalid/v1',
        keys: [{ 'api-key': 'fixture-key' }],
        'auto-discover-models': true,
        'excluded-models': ['*-preview'],
        models: [{ name: 'kept', alias: 'k' }],
      },
    ]);
    const config = load(groups());
    await providersApi.updateOpenAIProvider(config.name, 0, {
      ...config,
      autoDiscoverModels: false,
      excludedModels: undefined,
    });
    expect(groups()[0]).not.toHaveProperty('auto-discover-models');
    expect(groups()[0]).not.toHaveProperty('excluded-models');
    expect(groups()[0].models).toEqual([{ name: 'kept', alias: 'k' }]);
  });

  test('editing another field leaves an absent or explicit-false flag untouched', async () => {
    for (const flag of [{}, { 'auto-discover-models': false }]) {
      const raw = {
        name: 'fixture',
        'base-url': 'https://example.invalid/v1',
        keys: [{ 'api-key': 'fixture-key' }],
        ...flag,
      };
      const groups = backend([raw]);
      const config = load(groups());
      await providersApi.updateOpenAIProvider(config.name, 0, { ...config, priority: 5 });
      expect(groups()[0]).toEqual({ ...raw, priority: 5 });
    }
  });

  test('list rows count exclusions and tag discovering providers', () => {
    const resource = openaiToResource(
      {
        name: 'fixture',
        baseUrl: 'https://example.invalid/v1',
        apiKeyEntries: [],
        autoDiscoverModels: true,
        excludedModels: ['a', 'b'],
      },
      0
    );
    expect(resource.excludedModelCount).toBe(2);
    expect(resource.flags.autoDiscoverModels).toBe(true);
    expect(
      openaiToResource({ name: 'x', baseUrl: 'https://example.invalid', apiKeyEntries: [] }, 0)
        .flags
    ).toEqual({});
  });

  test('only OpenAI-compatible providers offer discovery; they now edit exclusions too', () => {
    const brands = Object.keys(PROVIDER_DESCRIPTORS) as ProviderBrand[];
    expect(
      brands.filter((brand) => PROVIDER_DESCRIPTORS[brand].supportsAutoDiscoverModels)
    ).toEqual(['openaiCompatibility']);
    expect(PROVIDER_DESCRIPTORS.openaiCompatibility.supportsExcludedModels).toBe(true);
  });

  test('the form loads both fields from the OpenAI config and localizes the toggle', () => {
    const source = readFileSync(
      new URL('../src/features/providers/sheets/forms/BaseProviderForm.tsx', import.meta.url),
      'utf8'
    );
    expect(source).toContain("excludedModelsText: (cfg.excludedModels ?? []).join('\\n')");
    expect(source).toContain('autoDiscoverModels: cfg.autoDiscoverModels === true');
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko']) {
      const messages = JSON.parse(
        readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
      );
      expect(messages.providersPage.form.autoDiscoverModels).toBeString();
      expect(messages.providersPage.form.autoDiscoverModelsHint).toBeString();
      expect(messages.providersPage.table.autoDiscoverTag).toBeString();
    }
  });
});
