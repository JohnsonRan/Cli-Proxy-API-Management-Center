import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { parseDocument } from 'yaml';
import i18n from '@/i18n';
import { SectionLogging } from '@/features/config/components/sections/SectionLogging';
import { findConfigFieldById } from '@/features/config/searchIndex';
import { validateVisualAdditions } from '@/features/config/visualConfigAdditions';
import { DEFAULT_VISUAL_VALUES } from '@/types/visualConfig';
import { runVisualConfig } from './helpers/visualConfig';

const renderLogging = (values = DEFAULT_VISUAL_VALUES) =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: i18n.cloneInstance({ lng: 'en' }) },
      createElement(SectionLogging, { values, disabled: false, onChange: () => {} })
    )
  );

describe('client quota endpoint (observability.quota-api)', () => {
  test('indexes the cache field in the logging section', () => {
    expect(findConfigFieldById('quotaApiEnabled')).toBeUndefined();
    expect(findConfigFieldById('quotaApiCacheTtlSeconds')).toMatchObject({
      sectionId: 'logging',
      yamlKeys: ['observability', 'quota-api', 'cache-ttl-seconds'],
    });
  });

  test('reads and writes the v8 block without touching siblings', () => {
    const yaml =
      'observability:\n  quota-api:\n    cache-ttl-seconds: 120 # keep\n' +
      '    keys:\n      - api-key: sk-a\n        credentials: [codex.json]\n' +
      '  usage:\n    usage-statistics-enabled: true\n';
    expect(runVisualConfig(yaml, []).visualValues.quotaApiCacheTtlSeconds).toBe('120');
    const config = runVisualConfig(yaml, [{ quotaApiCacheTtlSeconds: '90' }]);
    const doc = parseDocument(config.applyVisualChangesToYaml(yaml));
    expect(doc.getIn(['observability', 'quota-api', 'cache-ttl-seconds'])).toBe(90);
    expect(doc.getIn(['observability', 'quota-api', 'keys', 0, 'api-key'])).toBe('sk-a');
    expect(doc.getIn(['observability', 'usage', 'usage-statistics-enabled'])).toBe(true);
    expect([...config.visualDirtyFields]).toEqual(['quotaApiCacheTtlSeconds']);
  });

  test('saves the TTL as a number and removes it when cleared', () => {
    const yaml = 'observability:\n  quota-api:\n    keys: []\n';
    const set = runVisualConfig(yaml, [{ quotaApiCacheTtlSeconds: '600' }]);
    const written = parseDocument(set.applyVisualChangesToYaml(yaml));
    expect(written.getIn(['observability', 'quota-api', 'cache-ttl-seconds'])).toBe(600);

    const withTtl = 'observability:\n  quota-api:\n    keys: []\n    cache-ttl-seconds: 60\n';
    const cleared = runVisualConfig(withTtl, [{ quotaApiCacheTtlSeconds: '' }]);
    const doc = parseDocument(cleared.applyVisualChangesToYaml(withTtl));
    expect(doc.hasIn(['observability', 'quota-api', 'cache-ttl-seconds'])).toBe(false);
    expect(doc.hasIn(['observability', 'quota-api', 'keys'])).toBe(true);
  });

  test('rejects a negative or fractional TTL', () => {
    for (const quotaApiCacheTtlSeconds of ['-1', '1.5']) {
      expect(
        validateVisualAdditions({ ...DEFAULT_VISUAL_VALUES, quotaApiCacheTtlSeconds })
          .quotaApiCacheTtlSeconds
      ).toBe('non_negative_integer');
    }
    expect(
      validateVisualAdditions({ ...DEFAULT_VISUAL_VALUES, quotaApiCacheTtlSeconds: '0' })
        .quotaApiCacheTtlSeconds
    ).toBeUndefined();
  });

  test('renders the TTL after usage statistics, always editable', () => {
    const markup = renderLogging();
    const usage = markup.indexOf('cfg-field-usageStatisticsEnabled');
    const ttl = markup.indexOf('cfg-field-quotaApiCacheTtlSeconds');
    expect(usage).toBeGreaterThan(-1);
    expect(ttl).toBeGreaterThan(usage);
    expect(markup).not.toContain('cfg-field-quotaApiEnabled');
    const start = markup.indexOf('<input', ttl);
    expect(markup.slice(start, markup.indexOf('>', start))).not.toContain('disabled');
  });
});
