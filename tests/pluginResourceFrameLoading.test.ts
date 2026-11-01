import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const readSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Source contracts only: these do not verify iframe painting in a browser.
describe('plugin resource iframe loading', () => {
  const page = readSource('src/features/plugins/PluginResourcePage.tsx');
  const styles = readSource('src/features/plugins/PluginResourcePage.module.scss');

  test('iframe stays hidden until its document loads', () => {
    expect(page).toContain('onLoad={() => setLoadedSrc(iframeSrc)}');
    expect(page).toContain("frameReady ? '' : ` ${styles.frameLoading}`");
    expect(page).toContain('key={iframeSrc}');
    const block = styles.match(/\.frameLoading\s*\{([^}]+)\}/)?.[1];
    expect(block).toContain('opacity: 0;');
  });

  test('loading overlay covers the hidden iframe with the theme background', () => {
    const block = styles.match(/\.frameOverlay\s*\{([^}]+)\}/)?.[1];
    expect(block).toContain('position: absolute;');
    expect(block).toContain('background: var(--bg-secondary);');
  });

  test('refreshes do not unmount an already loaded iframe', () => {
    expect(page).toContain('{loading && !data ? (');
  });
});
