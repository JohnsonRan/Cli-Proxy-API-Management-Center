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
  test('indexes both fields in the logging section', () => {
    expect(findConfigFieldById('quotaApiEnabled')).toMatchObject({
      sectionId: 'logging',
      yamlKeys: ['observability', 'quota-api', 'enabled'],
    });
    expect(findConfigFieldById('quotaApiCacheTtlSeconds')).toMatchObject({
      sectionId: 'logging',
      yamlKeys: ['observability', 'quota-api', 'cache-ttl-seconds'],
    });
  });

  test('reads and writes the v8 block without touching siblings', () => {
    const yaml =
      'observability:\n  quota-api:\n    enabled: false # keep\n    cache-ttl-seconds: 120\n' +
      '  usage:\n    usage-statistics-enabled: true\n';
    const config = runVisualConfig(yaml, [{ quotaApiEnabled: true }]);
    expect(config.visualValues.quotaApiCacheTtlSeconds).toBe('120');
    const doc = parseDocument(config.applyVisualChangesToYaml(yaml));
    expect(doc.getIn(['observability', 'quota-api', 'enabled'])).toBe(true);
    expect(doc.getIn(['observability', 'quota-api', 'cache-ttl-seconds'])).toBe(120);
    expect(doc.getIn(['observability', 'usage', 'usage-statistics-enabled'])).toBe(true);
    expect([...config.visualDirtyFields]).toEqual(['quotaApiEnabled']);
  });

  test('saves the TTL as a number and removes it when cleared', () => {
    const yaml = 'observability:\n  quota-api:\n    enabled: true\n';
    const set = runVisualConfig(yaml, [{ quotaApiCacheTtlSeconds: '600' }]);
    const written = parseDocument(set.applyVisualChangesToYaml(yaml));
    expect(written.getIn(['observability', 'quota-api', 'cache-ttl-seconds'])).toBe(600);

    const withTtl = 'observability:\n  quota-api:\n    enabled: true\n    cache-ttl-seconds: 60\n';
    const cleared = runVisualConfig(withTtl, [{ quotaApiCacheTtlSeconds: '' }]);
    const doc = parseDocument(cleared.applyVisualChangesToYaml(withTtl));
    expect(doc.hasIn(['observability', 'quota-api', 'cache-ttl-seconds'])).toBe(false);
    expect(doc.getIn(['observability', 'quota-api', 'enabled'])).toBe(true);
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

  test('renders after usage statistics and locks the TTL while disabled', () => {
    const off = renderLogging();
    const usage = off.indexOf('cfg-field-usageStatisticsEnabled');
    const toggle = off.indexOf('cfg-field-quotaApiEnabled');
    const ttl = off.indexOf('cfg-field-quotaApiCacheTtlSeconds');
    expect(usage).toBeGreaterThan(-1);
    expect(toggle).toBeGreaterThan(usage);
    expect(ttl).toBeGreaterThan(toggle);
    const ttlInput = (markup: string) => {
      const start = markup.indexOf('<input', markup.indexOf('cfg-field-quotaApiCacheTtlSeconds'));
      return markup.slice(start, markup.indexOf('>', start));
    };
    expect(ttlInput(off)).toContain('disabled');
    expect(
      ttlInput(renderLogging({ ...DEFAULT_VISUAL_VALUES, quotaApiEnabled: true }))
    ).not.toContain('disabled');
  });
});
