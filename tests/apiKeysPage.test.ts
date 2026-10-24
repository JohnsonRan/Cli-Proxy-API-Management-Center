import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'bun:test';
import '@/i18n';
import { GlobalClientModelRulesCard } from '@/pages/GlobalClientModelRulesCard';
import { hasApiKeyModelRestrictions } from '@/utils/apiKeyScope';
import { maskApiKey } from '@/utils/format';
import { isValidApiKeyCharset } from '@/utils/validation';
import en from '@/i18n/locales/en.json';
import ko from '@/i18n/locales/ko.json';
import ru from '@/i18n/locales/ru.json';
import vi from '@/i18n/locales/vi.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';

describe('API Keys Page UI logic', () => {
  const keys = [
    'sk-test-super-strong-client-key-1234567890abcdef',
    'sk-short',
    'sk-medium-strength-key-12345',
  ];

  test('filters rows by name or key substring', () => {
    const rows = [
      { key: keys[0], name: 'Cursor' },
      { key: keys[1], name: 'Local Test' },
      { key: keys[2], name: '' },
    ];

    const filter = (query: string) => {
      const q = query.trim().toLowerCase();
      if (!q) return rows;
      return rows.filter(
        (r) => r.name.toLowerCase().includes(q) || r.key.toLowerCase().includes(q)
      );
    };

    expect(filter('cursor')).toHaveLength(1);
    expect(filter('cursor')[0].name).toBe('Cursor');
    expect(filter('short')).toHaveLength(1);
    expect(filter('short')[0].key).toBe('sk-short');
    expect(filter('sk-')).toHaveLength(3);
    expect(filter('non-existent')).toHaveLength(0);
  });

  test('counts keys with a restricted model scope', () => {
    const items = [
      { apiKey: keys[0] },
      { apiKey: keys[1], models: ['gpt-4o'] },
      { apiKey: keys[2], excludedModels: ['*-preview'] },
    ];

    const restricted = items.filter(hasApiKeyModelRestrictions).length;

    expect(restricted).toBe(2);
  });

  test('masks keys for privacy while preserving quick recognition', () => {
    expect(maskApiKey('sk-1234567890')).toMatch(/^sk\*+90$/);
    expect(maskApiKey('')).toBe('');
  });

  test('validates key charset according to security constraints', () => {
    expect(isValidApiKeyCharset('sk-valid-key-1234_XYZ')).toBe(true);
    expect(isValidApiKeyCharset('')).toBe(false);
    expect(isValidApiKeyCharset('invalid key with spaces')).toBe(false);
    expect(isValidApiKeyCharset('key\twith\ncontrol')).toBe(false);
    expect(isValidApiKeyCharset('密钥含中文')).toBe(false);
  });
});

describe('API Keys Page localization contracts', () => {
  const locales = [
    { name: 'zh-CN', dict: zhCN },
    { name: 'zh-TW', dict: zhTW },
    { name: 'en', dict: en },
    { name: 'ko', dict: ko },
    { name: 'ru', dict: ru },
    { name: 'vi', dict: vi },
  ];

  const requiredKeys = [
    'title',
    'description',
    'create_key',
    'refresh',
    'search_placeholder',
    'search_aria',
    'clear_search',
    'stat_total',
    'stat_total_desc',
    'stat_named',
    'stat_named_desc',
    'name_hint',
    'stat_restricted',
    'stat_restricted_desc',
    'table_name',
    'table_key',
    'table_models',
    'models_excluded_count',
    'table_actions',
    'unnamed',
    'show_key',
    'hide_key',
    'copy_key',
    'copied',
    'edit_key',
    'delete_key',
    'empty_title',
    'empty_desc',
    'empty_search_title',
    'empty_search_desc',
    'delete_modal_title',
    'delete_modal_confirm',
    'delete_btn',
  ];

  const removedKeys = ['table_index', 'table_strength', 'stat_security', 'stat_security_desc'];

  for (const { name, dict } of locales) {
    test(`locale ${name} drops the retired security/strength strings`, () => {
      const pageDict = (dict as Record<string, unknown>).api_keys_page as
        Record<string, string> | undefined;

      for (const key of removedKeys) {
        expect(pageDict?.[key]).toBeUndefined();
      }
    });
  }

  for (const { name, dict } of locales) {
    test(`locale ${name} contains all required api_keys_page strings`, () => {
      const pageDict = (dict as Record<string, unknown>).api_keys_page as
        Record<string, string> | undefined;
      expect(pageDict).toBeDefined();

      for (const key of requiredKeys) {
        expect(pageDict?.[key]).toBeDefined();
        expect(typeof pageDict?.[key]).toBe('string');
        expect(pageDict?.[key]?.length).toBeGreaterThan(0);
      }

      const globalDict = (pageDict as unknown as Record<string, unknown>)?.global_models as
        Record<string, string> | undefined;
      expect(globalDict).toBeDefined();
      for (const key of [
        'title',
        'description',
        'edit',
        'empty',
        'precedence',
        'allow_label',
        'allow_hint',
        'exclude_label',
        'exclude_hint',
        'inherited_badge',
        'inherited_hint',
      ]) {
        expect(typeof globalDict?.[key]).toBe('string');
        expect(globalDict?.[key]?.length).toBeGreaterThan(0);
      }
    });
  }

  test('renders GlobalClientModelRulesCard in summary and editing states', () => {
    const summaryMarkup = renderToStaticMarkup(
      createElement(GlobalClientModelRulesCard, {
        rules: { models: ['gpt-4o*'], excludedModels: ['*-preview'] },
        loading: false,
        disabled: false,
        candidates: [{ id: 'gpt-4o' }],
        catalogState: 'ready',
        onRetryCatalog: () => {},
        editing: false,
        onEditingChange: () => {},
        onSave: async () => true,
      })
    );
    expect(summaryMarkup).toContain('gpt-4o*');

    const editMarkup = renderToStaticMarkup(
      createElement(GlobalClientModelRulesCard, {
        rules: { models: ['gpt-4o*'], excludedModels: ['*-preview'] },
        loading: false,
        disabled: false,
        candidates: [{ id: 'gpt-4o' }],
        catalogState: 'ready',
        onRetryCatalog: () => {},
        editing: true,
        onEditingChange: () => {},
        onSave: async () => true,
      })
    );
    expect(editMarkup).toContain('access.models');
    expect(editMarkup).toContain('access.excluded-models');
  });
});
