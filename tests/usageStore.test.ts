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
  DEFAULT_EVENT_COLUMNS,
  clientKeyEntries,
  clientKeyId,
  emptyGlobalFilter,
  filterMultiSelectOptions,
  histogramLabels,
  mergeSelectedOptions,
  parseDraftRows,
  parseGlobalFilterFromSearchParams,
  providerDisplay,
  readEventColumns,
  serializeGlobalFilterToSearchParams,
  toEventsQuery,
  withSelectedOption,
} from '@/features/usage/logic';
import {
  cacheHitRate,
  changePercent,
  formatCompact,
  formatCost,
  formatDatetimeLocal,
  formatMs,
  parseDatetimeLocal,
  previousWindow,
  rangeWindow,
  successRate,
  validateCustomRange,
} from '@/features/usage/format';
import { EventDetailModal } from '@/features/usage/components/EventDetailModal';
import { ActivityHeatmap } from '@/features/usage/components/ActivityHeatmap';
import {
  buildUsageParams,
  normalizePriceOverrides,
  normalizeUsageAnalysis,
  normalizeUsageOptions,
  serializePriceOverrides,
} from '@/services/api/usageStore';

const aggregate = (requests: number, failed: number, cost: number, substituted = 0) => ({
  requests,
  failed,
  substituted,
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
        {
          id: 7,
          timestamp: 1000,
          model: 'm',
          failed: true,
          status_code: 429,
          priced: false,
          response_model: 'm-sub',
          substituted: true,
        },
      ],
    });
    expect(page.nextBefore).toBe(7);
    expect(page.events[0]).toMatchObject({
      id: 7,
      failed: true,
      statusCode: 429,
      priced: false,
      responseModel: 'm-sub',
      substituted: true,
    });

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

    // Range window extensions: today, yesterday, custom
    const nowMs = new Date(2026, 9, 24, 15, 30, 0).getTime();
    const todayWindow = rangeWindow('today', nowMs);
    const startOfToday = new Date(2026, 9, 24, 0, 0, 0).getTime() / 1000;
    expect(todayWindow.from).toBe(startOfToday);
    expect(todayWindow.to).toBe(Math.floor(nowMs / 1000));

    const yestWindow = rangeWindow('yesterday', nowMs);
    const startOfYesterday = new Date(2026, 9, 23, 0, 0, 0).getTime() / 1000;
    expect(yestWindow.from).toBe(startOfYesterday);
    expect(yestWindow.to).toBe(startOfToday);

    const customWindow = rangeWindow('custom', nowMs, 1000, 2000);
    expect(customWindow.from).toBe(1000);
    expect(customWindow.to).toBe(2000);

    // Datetime-local formatting and custom validation
    const dtStr = formatDatetimeLocal(startOfToday);
    expect(parseDatetimeLocal(dtStr)).toBe(startOfToday);
    expect(validateCustomRange(100, 200, 500)).toEqual({ valid: true });
    expect(validateCustomRange(200, 100, 500)).toEqual({ valid: false, error: 'order' });
    expect(validateCustomRange(100, 100, 500)).toEqual({ valid: false, error: 'order' });
    expect(validateCustomRange(100, 600, 500)).toEqual({ valid: false, error: 'future' });
    expect(validateCustomRange(null, 200, 500)).toEqual({ valid: false, error: 'empty' });
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
    const globalFilter = {
      ...emptyGlobalFilter(),
      models: ['m1', 'm2'],
      providers: ['p1'],
    };
    expect(toEventsQuery(window, globalFilter, 'failed')).toMatchObject({
      from: 10,
      to: 20,
      model: ['m1', 'm2'],
      provider: ['p1'],
      failed: true,
    });
    expect(toEventsQuery(window, globalFilter, 'success').failed).toBe(false);
    expect(toEventsQuery(window, globalFilter, 'substituted')).toMatchObject({
      substituted: true,
      failed: undefined,
    });
    expect(toEventsQuery(window, emptyGlobalFilter()).failed).toBeUndefined();
  });

  test('parses and serializes global filter URL search parameters', () => {
    const params = new URLSearchParams(
      'range=custom&from=100&to=200&model=m1,m2&provider=p1&api_key_id=k1&auth_index=a1,a2&tab=events&result=failed'
    );
    const filter = parseGlobalFilterFromSearchParams(params);
    expect(filter).toEqual({
      range: 'custom',
      customFrom: 100,
      customTo: 200,
      models: ['m1', 'm2'],
      providers: ['p1'],
      apiKeyIds: ['k1'],
      authIndexes: ['a1', 'a2'],
    });

    const serialized = serializeGlobalFilterToSearchParams(filter, 'events', 'failed');
    expect(serialized.get('tab')).toBe('events');
    expect(serialized.get('range')).toBe('custom');
    expect(serialized.get('from')).toBe('100');
    expect(serialized.get('to')).toBe('200');
    expect(serialized.get('model')).toBe('m1,m2');
    expect(serialized.get('provider')).toBe('p1');
    expect(serialized.get('api_key_id')).toBe('k1');
    expect(serialized.get('auth_index')).toBe('a1,a2');
    expect(serialized.get('result')).toBe('failed');
  });

  test('builds multi-value repeated query parameters for backend requests', () => {
    const search = buildUsageParams({
      from: 100,
      to: 200,
      model: ['m1', 'm2'],
      empty: [],
      nil: undefined,
    });
    expect(search.getAll('model')).toEqual(['m1', 'm2']);
    expect(search.get('from')).toBe('100');
    expect(search.get('to')).toBe('200');
    expect(search.has('empty')).toBe(false);
    expect(search.has('nil')).toBe(false);
  });

  test('normalizes options payload and filters multi-select options', () => {
    const options = normalizeUsageOptions({
      models: [{ model: 'gpt-5', provider: 'codex', requests: 10 }],
      providers: [{ provider: 'codex', requests: 10 }],
      api_keys: [{ api_key_id: 'k1', api_key: 'sk-1234', requests: 5 }],
      credentials: [
        {
          auth_index: 'a1',
          provider: 'codex',
          auth_type: 'oauth',
          source: 'user@test',
          requests: 5,
        },
      ],
    });
    expect(options.models).toHaveLength(1);
    expect(options.models[0]).toEqual({ model: 'gpt-5', provider: 'codex', requests: 10 });
    expect(options.providers[0]).toEqual({ provider: 'codex', requests: 10 });
    expect(options.apiKeys[0].apiKeyId).toBe('k1');
    expect(options.credentials[0].source).toBe('user@test');

    const multiOpts = [
      { value: 'gpt-5', label: 'GPT-5 Model' },
      { value: 'claude-3-5', label: 'Claude 3.5 Sonnet' },
    ];
    expect(filterMultiSelectOptions(multiOpts, 'gpt')).toEqual([multiOpts[0]]);
    expect(filterMultiSelectOptions(multiOpts, 'sonnet')).toEqual([multiOpts[1]]);
    expect(filterMultiSelectOptions(multiOpts, '  ')).toEqual(multiOpts);

    const merged = mergeSelectedOptions(multiOpts, ['gpt-5', 'unknown-model']);
    expect(merged).toHaveLength(3);
    expect(merged[0]).toEqual({ value: 'unknown-model', label: 'unknown-model' });
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

  test('EventDetailModal renders with closeOnBackdrop', () => {
    const markup = renderToStaticMarkup(
      createElement(EventDetailModal, {
        event: {
          id: 1,
          timestamp: 1000,
          requestId: 'req-1',
          provider: 'codex',
          model: 'gpt-5',
          alias: '',
          endpoint: 'POST /v1/chat/completions',
          authIndex: 'a1',
          source: 'user@test',
          apiKeyId: 'k1',
          apiKey: 'sk-1234',
          serviceTier: 'default',
          reasoningEffort: '',
          stream: false,
          failed: false,
          statusCode: 200,
          error: '',
          latencyMs: 100,
          ttftMs: 50,
          tokens: {
            inputUncached: 10,
            cacheRead: 0,
            cacheWrite: 0,
            output: 5,
            reasoning: 0,
            unclassified: 0,
            total: 15,
          },
          cost: 0.001,
          priced: true,
          clientIp: '127.0.0.1',
          userAgent: 'curl',
          responseModel: '',
          substituted: false,
        },
        labels: { credential: () => 'cred', keyName: () => 'key' },
        onClose: () => {},
      })
    );
    expect(markup).toContain('modal-overlay');
    expect(markup).toContain('gpt-5');
  });
});

describe('usage realtime', () => {
  test('normalizes the realtime payload', async () => {
    const { normalizeUsageRealtime } = await import('@/services/api/usageStore');
    const rt = normalizeUsageRealtime({
      now: 120,
      last_id: 9,
      current: { rpm_1m: 3, tpm_1m: 900, rpm_5m: 1.5, failed_5m: 2, avg_latency_5m: 420 },
      series: [{ time: 60, requests: 3, failed: 1, tokens: 900, avg_latency_ms: 400 }, 'junk'],
    });
    expect(rt.lastId).toBe(9);
    expect(rt.current).toEqual({
      rpm1m: 3,
      tpm1m: 900,
      rpm5m: 1.5,
      tpm5m: 0,
      failed5m: 2,
      avgLatency5m: 420,
    });
    expect(rt.series).toHaveLength(1);
    expect(rt.series[0]).toMatchObject({ time: 60, requests: 3, failed: 1, avgLatencyMs: 400 });
  });

  test('merges ascending pages into a newest-first capped feed', async () => {
    const { mergeRealtimeFeed } = await import('@/features/usage/logic');
    const feed = [{ id: 5 }, { id: 4 }];
    const merged = mergeRealtimeFeed(feed, [{ id: 5 }, { id: 6 }, { id: 7 }], 3);
    expect(merged.feed.map((e) => e.id)).toEqual([7, 6, 5]);
    expect(merged.added).toEqual([7, 6]);
    expect(mergeRealtimeFeed(feed, []).feed.map((e) => e.id)).toEqual([5, 4]);
    expect(mergeRealtimeFeed(feed, []).added).toEqual([]);
  });
});

describe('usage event cells', () => {
  test('derives the downstream transport and cache hit rate', async () => {
    const { eventTransport, eventCacheHitRate, DEFAULT_EVENT_COLUMNS, EVENT_COLUMNS } =
      await import('@/features/usage/logic');
    expect(eventTransport('GET /v1/responses', true)).toBe('ws');
    expect(eventTransport('get /v1/realtime', false)).toBe('ws');
    expect(eventTransport('POST /v1/chat/completions', true)).toBe('sse');
    expect(eventTransport('POST /v1/chat/completions', false)).toBe('http');
    expect(eventTransport('', false)).toBe('http');
    expect(eventCacheHitRate({ inputUncached: 25, cacheRead: 75, cacheWrite: 0 })).toBe(75);
    expect(eventCacheHitRate({ inputUncached: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull();
    expect(EVENT_COLUMNS).not.toContain('tier');
    expect(
      DEFAULT_EVENT_COLUMNS.every((c) => (EVENT_COLUMNS as readonly string[]).includes(c))
    ).toBe(true);
  });
});
