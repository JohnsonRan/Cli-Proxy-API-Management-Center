import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { apiClient } from '@/services/api/client';
import { providersApi } from '@/services/api/providers';
import { normalizeProviderGroups } from '@/services/api/transformers';
import { openaiToResource } from '@/features/providers/adapters';
import { ResourceCard } from '@/features/providers/components/ResourceCard';
import { PROVIDER_DESCRIPTORS } from '@/features/providers/descriptors';
import { BaseProviderForm } from '@/features/providers/sheets/forms/BaseProviderForm';
import type { ProviderBrand, ProviderEntryFormInput } from '@/features/providers/types';
import { buildOpenAIConfig } from '@/features/providers/useProviderWorkbench';
import en from '@/i18n/locales/en.json';
import type { OpenAIProviderConfig } from '@/types';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
const render = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));

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

  test('connection cards show the exclusion count and tag only discovering providers', () => {
    const config = {
      name: 'fixture',
      baseUrl: 'https://example.invalid/v1',
      apiKeyEntries: [],
    };
    const card = (overrides: Partial<OpenAIProviderConfig>) =>
      render(
        createElement(ResourceCard, {
          resource: openaiToResource({ ...config, ...overrides }, 0),
          selected: false,
          disableMutations: false,
          usage: null,
          onView: () => {},
          onEdit: () => {},
          onDelete: () => {},
          onToggleDisabled: () => {},
        })
      );
    const { autoDiscoverTag } = en.providersPage.table;
    const { excludedModels } = en.providersPage.detail.fields;
    const html = card({ autoDiscoverModels: true, excludedModels: ['*-preview', '*'] });
    expect(html).toContain(`>${autoDiscoverTag}</span>`);
    expect(html).toContain(`>${excludedModels}</span>2</span>`);
    const defaultCard = card({ autoDiscoverModels: false });
    expect(defaultCard).not.toContain(autoDiscoverTag);
    expect(defaultCard).not.toContain(excludedModels);
  });

  test('only OpenAI-compatible providers offer discovery; they now edit exclusions too', () => {
    const brands = Object.keys(PROVIDER_DESCRIPTORS) as ProviderBrand[];
    expect(
      brands.filter((brand) => PROVIDER_DESCRIPTORS[brand].supportsAutoDiscoverModels)
    ).toEqual(['openaiCompatibility']);
    expect(PROVIDER_DESCRIPTORS.openaiCompatibility.supportsExcludedModels).toBe(true);
  });

  test('the OpenAI form loads the discovery switch and keeps the wildcard in the rule editor', () => {
    const config = load([
      {
        name: 'fixture',
        'base-url': 'https://example.invalid/v1',
        keys: [{ 'api-key': 'fixture-key' }],
        'auto-discover-models': true,
        'excluded-models': ['*-preview', '*'],
      },
    ]);
    const html = render(
      createElement(BaseProviderForm, {
        brand: 'openaiCompatibility',
        resource: openaiToResource(config, 0),
        mode: 'edit',
        mutating: false,
        formId: 'discovery-fixture',
        onSubmit: async () => {},
      })
    );
    const copy = en.providersPage.form;
    const sections = [...html.matchAll(/<details\b[^]*?<\/details>/g)].map(([section]) => section);
    const models = sections.find((section) => section.includes(`>${copy.modelsSection}</span>`));
    const discovery = models?.match(/<input[^>]*role="switch"[^>]*>/)?.[0];
    expect(discovery).toContain('checked=""');
    const hintId = discovery?.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(models).toContain(`>${copy.autoDiscoverModels}</span>`);
    expect(models).toContain(
      `<span id="${hintId}" hidden="">${copy.autoDiscoverModelsHint.replaceAll("'", '&#x27;')}</span>`
    );
    expect(models).toContain(en.providersPage.discovery.openButton);
    const exclusions = sections.find((section) => section.includes(`>${copy.excludedSection}</span>`));
    expect(exclusions).toMatch(/<textarea[^>]*>\*-preview\n\*<\/textarea>/);
  });

  test('all locales carry the auto-discovery switch, hint and badge copy', () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr']) {
      const messages = JSON.parse(
        readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
      );
      expect(messages.providersPage.form.autoDiscoverModels).toBeString();
      expect(messages.providersPage.form.autoDiscoverModelsHint).toBeString();
      expect(messages.providersPage.table.autoDiscoverTag).toBeString();
    }
  });
});
