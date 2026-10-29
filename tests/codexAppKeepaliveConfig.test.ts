import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { parseDocument } from 'yaml';
import i18n from '@/i18n';
import { SectionStreaming } from '@/features/config/components/sections/SectionStreaming';
import { findConfigFieldById } from '@/features/config/searchIndex';
import { getVisualConfigValidationErrors } from '@/hooks/useVisualConfig';
import { DEFAULT_VISUAL_VALUES, type VisualConfigValues } from '@/types/visualConfig';
import { runVisualConfig } from './helpers/visualConfig';

const translations = i18n.cloneInstance({ lng: 'en' });
const render = (values: VisualConfigValues) =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: translations },
      createElement(SectionStreaming, { values, disabled: false, onChange: () => {} })
    )
  );

describe('Codex app keepalive settings', () => {
  test('index the backend requests.streaming paths', () => {
    expect(findConfigFieldById('codexAppKeepaliveSeconds')?.yamlKeys?.join('.')).toBe(
      'requests.streaming.codex-app-keepalive-seconds'
    );
    expect(findConfigFieldById('disableCodexAppKeepalive')?.yamlKeys?.join('.')).toBe(
      'requests.streaming.disable-codex-app-keepalive'
    );
  });

  test('write next to the existing streaming keys without touching them', () => {
    const yaml = 'requests:\n  streaming:\n    keepalive-seconds: 15 # keep\n';
    const config = runVisualConfig(yaml, [
      { codexAppKeepaliveSeconds: '45', disableCodexAppKeepalive: true },
    ]);
    const output = config.applyVisualChangesToYaml(yaml);
    const doc = parseDocument(output);
    expect(doc.getIn(['requests', 'streaming', 'keepalive-seconds'])).toBe(15);
    expect(doc.getIn(['requests', 'streaming', 'codex-app-keepalive-seconds'])).toBe(45);
    expect(doc.getIn(['requests', 'streaming', 'disable-codex-app-keepalive'])).toBe(true);
    expect(output).toContain('# keep');
  });

  test('clearing the interval removes the key so the backend default applies', () => {
    const yaml = 'requests:\n  streaming:\n    codex-app-keepalive-seconds: 45\n';
    const output = runVisualConfig(yaml, [
      { codexAppKeepaliveSeconds: '' },
    ]).applyVisualChangesToYaml(yaml);
    expect(
      parseDocument(output).hasIn(['requests', 'streaming', 'codex-app-keepalive-seconds'])
    ).toBe(false);
  });

  test('accept negative intervals like core (default) and reject fractions', () => {
    const errors = (codexAppKeepaliveSeconds: string) =>
      getVisualConfigValidationErrors({ ...DEFAULT_VISUAL_VALUES, codexAppKeepaliveSeconds })
        .codexAppKeepaliveSeconds;
    expect(errors('')).toBeUndefined();
    expect(errors('0')).toBeUndefined();
    expect(errors('30')).toBeUndefined();
    expect(errors('-1')).toBeUndefined();
    expect(errors('1.5')).toBe('integer');
  });

  test('render both fields and lock the interval while the keepalive is disabled', () => {
    const enabled = render(DEFAULT_VISUAL_VALUES);
    expect(enabled).toContain('id="cfg-field-codexAppKeepaliveSeconds"');
    expect(enabled).toContain('id="cfg-field-disableCodexAppKeepalive"');
    expect(enabled).toContain('placeholder="30"');
    const intervalInput = (markup: string) =>
      markup.match(/<input\b[^>]*placeholder="30"[^>]*>/)?.[0] ?? '';
    expect(intervalInput(enabled)).not.toContain('disabled=""');
    const disabled = render({ ...DEFAULT_VISUAL_VALUES, disableCodexAppKeepalive: true });
    expect(intervalInput(disabled)).toContain('disabled=""');
  });
});
