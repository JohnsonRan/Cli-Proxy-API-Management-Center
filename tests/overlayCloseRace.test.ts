import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const readSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Callers pass inline onClose handlers. If startClose depended on onClose, any parent
// render during the close animation would re-run the open effect, clear the close timer
// and leave the overlay open. Structural guard; there is no DOM test environment here.
describe.each(['src/components/ui/Modal.tsx', 'src/components/ui/Sheet/Sheet.tsx'])(
  '%s close survives parent renders',
  (path) => {
    const source = readSource(path);
    const startClose = source.match(/const startClose = useCallback\(([\s\S]*?)\);\n\n/)?.[1] ?? '';

    test('startClose has no dependencies', () => {
      expect(startClose).not.toBe('');
      expect(startClose.replace(/\s+/g, '')).toEndWith(',[]');
    });

    test('startClose calls the latest onClose through a ref', () => {
      expect(startClose).toContain('onCloseRef.current()');
      expect(startClose).not.toMatch(/\bonClose\(\)/);
      expect(source).toMatch(/onCloseRef\.current = onClose;/);
    });
  }
);
