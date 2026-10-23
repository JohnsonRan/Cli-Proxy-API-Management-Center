import { describe, expect, test } from 'bun:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '@/i18n';
import {
  isUsageStoreDisabled,
  normalizeUsageEvents,
  normalizeUsagePricing,
  normalizeUsageStats,
} from '@/services/api/usageStore';
import {
  cacheHitRate,
  changePercent,
  formatCompact,
  formatCost,
  formatMs,
  previousWindow,
  rangeWindow,
  successRate,
} from '@/features/usage/format';
import {
  DEFAULT_EVENT_COLUMNS,
  clientKeyEntries,
  clientKeyId,
  providerDisplay,
  histogramLabels,
  parseDraftRows,
  readEventColumns,
  toEventsQuery,
  withSelectedOption,
} from '@/features/usage/logic';
import { ActivityHeatmap } from '@/features/usage/components/ActivityHeatmap';
import {
  normalizePriceOverrides,
  normalizeUsageAnalysis,
  serializePriceOverrides,
} from '@/services/api/usageStore';

const aggregate = (requests: number, failed: number, cost: number) => ({
  requests,
  failed,
  cost,
  unpriced_requests: 0,
  avg_latency_ms: 120,
  avg_ttft_ms: 40,
  tokens: { input_uncached: 600, cache_read: 400, output: 200, reasoning: 50, total: 1200 },
});

describe('usage store API normalization', () => {
  test('maps the backend stats payload to camelCase and tolerates bad fields', () => {
    const stats = normalizeUsageStats({
      from: 100,
      to: 200,
      bucket: 'day',
      totals: aggregate(3, 1, 0.5),
      series: [{ time: 100, ...aggregate(3, 1, 0.5) }, 'junk'],
      models: [
        { model: 'gpt-5', provider: 'codex', price_source: 'models.dev', ...aggregate(3, 1, 0.5) },
      ],
      api_keys: [{ api_key_id: 'abc', api_key: 'sk-a...0001', ...aggregate(3, 1, 0.5) }],
      credentials: null,
    });
    expect(stats.bucket).toBe('day');
    expect(stats.totals.tokens.cacheRead).toBe(400);
    expect(stats.totals.tokens.cacheWrite).toBe(0);
    expect(stats.series).toHaveLength(1);
    expect(stats.models[0].priceSource).toBe('models.dev');
    expect(stats.apiKeys[0].apiKey).toBe('sk-a...0001');
    expect(stats.credentials).toEqual([]);
    expect(normalizeUsageStats(null).bucket).toBe('hour');
  });

  test('maps events and pricing', () => {
    const page = normalizeUsageEvents({
      next_before: 7,
      events: [
        { id: 7, timestamp: 1000, model: 'm', failed: true, status_code: 429, priced: false },
      ],
    });
    expect(page.nextBefore).toBe(7);
    expect(page.events[0]).toMatchObject({ id: 7, failed: true, statusCode: 429, priced: false });

    const pricing = normalizeUsagePricing({
      models_dev: { enabled: true, count: 10, updated_at: '2026-10-23T00:00:00Z', last_error: '' },
      models: [
        {
          model: 'a',
          source: 'override',
          price: { input: 1, output: 2, cache_read: 0.1, cache_write: 1 },
        },
        { model: 'b', source: '', price: null },
      ],
    });
    expect(pricing.modelsDev.count).toBe(10);
    expect(pricing.models[0].price?.cacheRead).toBe(0.1);
    expect(pricing.models[1].price).toBeNull();
  });

  test('recognizes only the disabled-store conflict', () => {
    expect(isUsageStoreDisabled({ status: 409, apiCode: 'usage_store_disabled' })).toBe(true);
    expect(isUsageStoreDisabled({ status: 409, apiCode: 'other' })).toBe(false);
    expect(isUsageStoreDisabled({ status: 500, apiCode: 'usage_store_disabled' })).toBe(false);
    expect(isUsageStoreDisabled(null)).toBe(false);
  });
});

describe('usage formatting', () => {
  test('formats costs, counts and durations', () => {
    expect(formatCost(0)).toBe('$0');
    expect(formatCost(0.00001)).toBe('<$0.0001');
    expect(formatCost(0.0084)).toBe('$0.0084');
    expect(formatCost(12.345)).toBe('$12.35');
    expect(formatCost(1234.5)).toBe('$1,235');
    expect(formatCompact(950)).toBe('950');
    expect(formatCompact(1250)).toBe('1.3K');
    expect(formatCompact(3_400_000)).toBe('3.4M');
    expect(formatCompact(250_000_000)).toBe('250M');
    expect(formatMs(0)).toBe('—');
    expect(formatMs(420)).toBe('420 ms');
    expect(formatMs(1500)).toBe('1.50 s');
  });

  test('computes rates, windows and period changes', () => {
    expect(successRate({ requests: 0, failed: 0 })).toBeNull();
    expect(successRate({ requests: 4, failed: 1 })).toBe(75);
    const window = rangeWindow('7d', 1_700_000_000_000);
    expect(window.to - window.from).toBe(7 * 86400);
    expect(window.tzOffset).toBe(-new Date(1_700_000_000_000).getTimezoneOffset());
    expect(previousWindow({ from: 100, to: 160 })).toEqual({ from: 40, to: 100 });
    expect(changePercent(150, 100)).toBe(50);
    expect(changePercent(5, 0)).toBeNull();
    const totals = normalizeUsageStats({ totals: aggregate(1, 0, 0) }).totals;
    expect(cacheHitRate(totals)).toBe(40);
  });
});

describe('usage analysis and pricing helpers', () => {
  test('normalizes analysis and labels histogram buckets', () => {
    const analysis = normalizeUsageAnalysis({
      latency: { count: 3, p50: 900, p95: 4000 },
      histogram: [1, 2, 0],
      histogram_bounds_ms: [500, 1000],
      heatmap: [{ weekday: 1, hour: 7, requests: 5 }],
      models: 'junk',
    });
    expect(analysis.latency).toEqual({ count: 3, p50: 900, p90: 0, p95: 4000, p99: 0, max: 0 });
    expect(analysis.models).toEqual([]);
    expect(histogramLabels(analysis.histogramBoundsMs)).toEqual(['≤0.5s', '0.5s–1s', '>1s']);
  });

  test('round-trips overrides and keeps unset cache prices unset', () => {
    const overrides = normalizePriceOverrides([
      { model: ' gpt-5 ', input: 1.25, output: 10, 'cache-read': 0 },
      { model: '', input: 1 },
      'junk',
    ]);
    expect(overrides).toEqual([
      { model: 'gpt-5', input: 1.25, output: 10, cacheRead: 0, cacheWrite: undefined },
    ]);
    expect(serializePriceOverrides(overrides)).toEqual([
      { model: 'gpt-5', input: 1.25, output: 10, 'cache-read': 0 },
    ]);
  });

  test('validates draft price rows', () => {
    const row = (model: string, input: string, output = '1', cacheRead = '', cacheWrite = '') => ({
      model,
      input,
      output,
      cacheRead,
      cacheWrite,
    });
    expect(parseDraftRows([row('a', '1', '2', '0.1'), row('', '', '', '', '')])).toEqual({
      overrides: [{ model: 'a', input: 1, output: 2, cacheRead: 0.1, cacheWrite: undefined }],
    });
    expect(parseDraftRows([row('a', '1'), row('A', '2')])).toEqual({ invalidRow: 1 });
    expect(parseDraftRows([row('a', '-1')])).toEqual({ invalidRow: 0 });
    expect(parseDraftRows([row('a', '')])).toEqual({ invalidRow: 0 });
    expect(parseDraftRows([row('', '1')])).toEqual({ invalidRow: 0 });
  });

  test('reads stored event columns and builds event queries', () => {
    expect(readEventColumns(null)).toEqual(DEFAULT_EVENT_COLUMNS);
    expect(readEventColumns('{bad')).toEqual(DEFAULT_EVENT_COLUMNS);
    expect(readEventColumns('["cost","bogus","time"]')).toEqual(['time', 'cost']);
    const window = { from: 10, to: 20, tzOffset: 0 };
    expect(toEventsQuery(window, { model: 'm', result: 'failed' })).toMatchObject({
      from: 10,
      to: 20,
      model: 'm',
      failed: true,
    });
    expect(toEventsQuery(window, { result: 'success' }).failed).toBe(false);
    expect(toEventsQuery(window, {}).failed).toBeUndefined();
  });

  test('keeps URL-seeded or stale selected options visible in filter selects', () => {
    const options = [
      { value: '', label: 'All' },
      { value: 'gpt-5', label: 'gpt-5' },
    ];
    expect(withSelectedOption(options, 'gpt-5')).toBe(options);
    expect(withSelectedOption(options, '')).toBe(options);
    expect(withSelectedOption(options, undefined)).toBe(options);
    expect(withSelectedOption(options, 'gpt-4')).toEqual([
      { value: '', label: 'All' },
      { value: 'gpt-5', label: 'gpt-5' },
      { value: 'gpt-4', label: 'gpt-4' },
    ]);
  });

  test('labels providers and client keys like the rest of the panel', () => {
    expect(providerDisplay('openai-compatible-acme')).toEqual({
      type: 'openai',
      name: 'acme',
      compat: true,
    });
    expect(providerDisplay('gemini-cli')).toEqual({ type: 'gemini', name: null, compat: false });
    expect(providerDisplay('codex')).toEqual({ type: 'codex', name: null, compat: false });
    // Must match the core's hex(sha256(key)[:6]) grouping id; sha256("abc") starts with ba7816bf8f01.
    const digest = bytesToHex(sha256(new TextEncoder().encode('abc')));
    expect(clientKeyId(digest)).toBe('ba7816bf8f01');
    expect(
      clientKeyEntries([
        ' sk-plain ',
        { 'api-key': 'sk-named', name: ' Alice ', models: ['gpt-5'] },
        { 'api-key': 'sk-unnamed' },
        { name: 'no key' },
        42,
      ])
    ).toEqual([{ key: 'sk-plain' }, { key: 'sk-named', name: 'Alice' }, { key: 'sk-unnamed' }]);
    expect(clientKeyEntries(null)).toEqual([]);
  });

  test('heatmap renders a 7x24 grid scaled to the busiest cell', () => {
    const markup = renderToStaticMarkup(
      createElement(ActivityHeatmap, {
        cells: [
          { weekday: 1, hour: 7, requests: 10, tokens: 0, failed: 1, cost: 0 },
          { weekday: 2, hour: 8, requests: 5, tokens: 0, failed: 0, cost: 0 },
        ],
        metric: 'requests',
      })
    );
    expect(markup.match(/role="cell"/g)).toHaveLength(7 * 24);
    expect(markup).toContain('opacity:1');
    expect(markup).toContain('opacity:0.575');
    expect(markup.match(/data-empty="true"/g)).toHaveLength(7 * 24 - 2);
  });
});
