import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '@/components/ui/Button';
import { IconKey } from '@/components/ui/icons';

const styles = readFileSync(new URL('../src/styles/components.scss', import.meta.url), 'utf8');
const buttonSource = readFileSync(
  new URL('../src/components/ui/Button.tsx', import.meta.url),
  'utf8'
);

/** Text of the top-level `.btn { … }` rule; nested rules close with extra indentation. */
function btnRule(): string {
  const start = styles.indexOf('\n.btn {');
  expect(start).toBeGreaterThanOrEqual(0);
  return styles.slice(start, styles.indexOf('\n}\n', start));
}

describe('button icon and label layout', () => {
  test('renders the child span with a label class', () => {
    expect(buttonSource).toContain('<span className="btn-label">{children}</span>');
  });

  test('keeps the icon inside the label span instead of on the text baseline', () => {
    const markup = renderToStaticMarkup(
      createElement(Button, null, createElement(IconKey, { size: 14 }), '刷新')
    );

    expect(markup).toContain('<span class="btn-label">');
    expect(markup).toMatch(/<span class="btn-label"><svg[\s\S]*<\/svg>刷新<\/span>/);
  });

  test('lays the label span out as one centered row that survives any icon size', () => {
    const rule = btnRule();
    expect(rule).toContain('> .btn-label {');

    const label = rule.slice(rule.indexOf('> .btn-label {'), rule.indexOf('svg {'));
    expect(label).toContain('display: inline-flex');
    expect(label).toContain('align-items: center');
    expect(label).toContain('gap: $spacing-sm');
    // The line box, not the SVG, must decide the height: a 14px and a 16px icon
    // would otherwise produce buttons two pixels apart.
    expect(label).toContain('line-height: 1.5');

    const svg = rule.slice(rule.indexOf('svg {'));
    expect(svg).toContain('display: block');
    expect(svg).toContain('flex-shrink: 0');
  });

  test('does not lay out the loading spinner as a label row', () => {
    // The spinner is a direct child of .btn too, so the rule targets the class
    // rather than every span: a 16px round spinner must stay square.
    expect(btnRule()).not.toMatch(/>\s*span\s*\{/);
  });

  test('retires the per-call-site empty-action workaround this rule replaces', () => {
    expect(styles).not.toContain('.empty-action .btn > span');
    expect(styles).not.toContain('.empty-action .btn svg');
  });

  test('leaves no per-page copy of the same workaround behind', () => {
    const converted = [
      '../src/features/authFiles/components/AuthFileCard.module.scss',
      '../src/features/plugins/PluginsPage.module.scss',
      '../src/features/plugins/PluginStorePage.module.scss',
    ];

    for (const path of converted) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(source).not.toContain('.btn > span');
      expect(source).not.toContain('.btn svg');
    }
  });
});
