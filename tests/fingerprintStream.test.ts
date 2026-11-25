import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseFingerprintStream } from '../src/services/api/fingerprint';

const sample = (index: number, state: string, count: number) =>
  JSON.stringify({
    type: 'sample',
    index,
    sample: { state, count, expected_count: 40, response_model: null, error: null },
  });

describe('parseFingerprintStream', () => {
  test('keeps the latest snapshot per sample and ignores an incomplete tail', () => {
    const body = [
      sample(0, 'queued', 0),
      sample(1, 'queued', 0),
      sample(0, 'streaming', 12),
      sample(1, 'waiting', 0),
      '{"type":"sample","index":1,"sam',
    ].join('\n');
    const state = parseFingerprintStream(body);
    expect(state.samples.map((item) => `${item.state}/${item.count}`)).toEqual([
      'streaming/12',
      'waiting/0',
    ]);
    expect(state.result).toBeNull();
  });

  test('reads the result line and the error line', () => {
    const result = { built_at: '2026-10-01', samples: [], analysis: null, error: null };
    const done = parseFingerprintStream(
      `${sample(0, 'complete', 40)}\n${JSON.stringify({ type: 'result', result })}\n`
    );
    expect(done.result).toEqual(result);

    const failed = parseFingerprintStream(
      `${sample(0, 'queued', 0)}\n{"type":"error","error":"bad"}\n`
    );
    expect(failed.error).toBe('bad');
    expect(failed.result).toBeNull();
  });

  test('accepts the plain JSON answer of a core without progress support', () => {
    const result = { built_at: 'x', samples: [], analysis: null, error: null };
    expect(parseFingerprintStream(result).result).toBe(result);
    expect(parseFingerprintStream(`${JSON.stringify(result)}\n`).result).toEqual(result);
  });
});

test('the logs entry stays last in the observe group', () => {
  const source = readFileSync('src/components/layout/MainLayout.tsx', 'utf8');
  const group = source.slice(source.indexOf("id: 'observe'"), source.indexOf("id: 'control'"));
  const paths = [...group.matchAll(/path: '([^']+)'/g)].map((match) => match[1]);
  expect(paths.at(-1)).toBe('/logs');
  expect(paths).toContain('/fingerprint');
});
