import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { parseDocument } from 'yaml';
import i18n from '@/i18n';
import { SectionLogging } from '@/features/config/components/sections/SectionLogging';
import { findConfigFieldById } from '@/features/config/searchIndex';
import { DEFAULT_VISUAL_VALUES } from '@/types/visualConfig';
import { runVisualConfig } from './helpers/visualConfig';

describe('usage statistics: exclude embeddings', () => {
  test('indexes observability.usage.exclude-embeddings in the logging section', () => {
    expect(findConfigFieldById('usageExcludeEmbeddings')).toMatchObject({
      sectionId: 'logging',
      yamlKeys: ['observability', 'usage', 'exclude-embeddings'],
    });
  });

  test('writes beside usage-statistics-enabled without touching it', () => {
    const yaml = 'observability:\n  usage:\n    usage-statistics-enabled: true # keep\n';
    const config = runVisualConfig(yaml, [{ usageExcludeEmbeddings: true }]);
    expect(config.visualValues.usageStatisticsEnabled).toBe(true);
    const output = config.applyVisualChangesToYaml(yaml);
    const doc = parseDocument(output);
    expect(doc.getIn(['observability', 'usage', 'exclude-embeddings'])).toBe(true);
    expect(doc.getIn(['observability', 'usage', 'usage-statistics-enabled'])).toBe(true);
    expect(output).toContain('# keep');
    expect([...config.visualDirtyFields]).toEqual(['usageExcludeEmbeddings']);
  });

  test('renders the switch right after the usage statistics switch', () => {
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n: i18n.cloneInstance({ lng: 'en' }) },
        createElement(SectionLogging, {
          values: DEFAULT_VISUAL_VALUES,
          disabled: false,
          onChange: () => {},
        })
      )
    );
    const usage = markup.indexOf('cfg-field-usageStatisticsEnabled');
    const exclude = markup.indexOf('cfg-field-usageExcludeEmbeddings');
    expect(usage).toBeGreaterThan(-1);
    expect(exclude).toBeGreaterThan(usage);
  });
});
