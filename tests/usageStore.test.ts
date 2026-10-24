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
  alignPrevious,
  clientKeyEntries,
  clientKeyId,
  emptyGlobalFilter,
  filterMultiSelectOptions,
  histogramLabels,
  cacheSavings,
  mergeSelectedOptions,
  nextSort,
  parseUsagePrefs,
  sortRows,
  toCsv,
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
  costPerRequest,
  exactCost,
  exactCount,
  formatCompact,
  formatCost,
  formatDatetimeLocal,
  formatMs,
  formatTps,
  parseDatetimeLocal,
  previousWindow,
  rangeWindow,
  successRate,
  tokensPerRequest,
  validateCustomRange,
} from '@/features/usage/format';
import { baseCartesianOptions } from '@/features/usage/charts';
import { OverviewTab } from '@/features/usage/tabs/OverviewTab';
import { SortHead } from '@/features/usage/components/SortHead';
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
  output_tps: 85.5,
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
    expect(stats.totals.outputTps).toBe(85.5);
    expect(stats.series[0].outputTps).toBe(85.5);
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
          output_tps: 'junk',
        },
      ],
    });
    expect(page.nextBefore).toBe(7);
    expect(page.events[0]).toMatchObject({
      id: 7,
      outputTps: 0,
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
    expect(formatCompact(999_949)).toBe('1M');
    expect(formatCompact(999_950_000)).toBe('1B');
    expect(exactCount(950)).toBeUndefined();
    expect(exactCount(12_345_678)).toBe('12,345,678');
    expect(exactCost(1234.5)).toBe('$1,234.50');
    expect(exactCost(0.00843)).toBe('$0.0084');
    expect(formatMs(0)).toBe('—');
    expect(formatMs(420)).toBe('420 ms');
    expect(formatMs(1500)).toBe('1.50 s');
    expect(formatTps(0)).toBe('—');
    expect(formatTps(Number.NaN)).toBe('—');
    expect(formatTps(42.46)).toBe('42.5 t/s');
    expect(formatTps(1234.4)).toBe('1,234 t/s');
  });

  test('chart axes and tooltips use compact units unless told otherwise', () => {
    const theme = {
      text: '',
      muted: '',
      grid: '',
      success: '',
      failure: '',
      surface: '',
    };
    const counts = baseCartesianOptions(theme, true);
    expect(counts.scales.y.ticks.callback(12_500_000)).toBe('12.5M');
    const label = counts.plugins.tooltip.callbacks.label;
    expect(label({ dataset: { label: 'Input' }, parsed: { y: 3_400 } })).toBe('Input: 3.4K');
    expect(label({ dataset: {}, parsed: { y: null } })).toBe('0');
    expect(counts.scales.y.ticks.precision).toBe(0);
    const cost = baseCartesianOptions(theme, false, formatCost);
    expect('precision' in cost.scales.y.ticks).toBe(false);
    expect(cost.scales.y.ticks.callback('1234.5')).toBe('$1,235');
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
    const four = normalizeUsageStats({
      totals: { ...aggregate(4, 0, 0.9), unpriced_requests: 1 },
    }).totals;
    expect(tokensPerRequest(four)).toBe(300);
    expect(costPerRequest(four)).toBeCloseTo(0.3);
    expect(costPerRequest({ ...four, unpricedRequests: 4 })).toBeNull();
    expect(tokensPerRequest({ ...four, requests: 0 })).toBe(0);

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
      tps: { count: 2, p50: 120 },
      histogram: [1, 2, 0],
      histogram_bounds_ms: [500, 1000],
      heatmap: [{ weekday: 1, hour: 7, requests: 5 }],
      models: 'junk',
    });
    expect(analysis.latency).toEqual({ count: 3, p50: 900, p90: 0, p95: 4000, p99: 0, max: 0 });
    expect(analysis.tps.p50).toBe(120);
    expect(analysis.models).toEqual([]);
    const withModels = normalizeUsageAnalysis({ models: [{ model: 'm', tps: { p50: 64 } }] });
    expect(withModels.models[0].tps.p50).toBe(64);
    expect(normalizeUsageAnalysis({}).tps.count).toBe(0);
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

  test('lists overrides inline with effective prices and replaces them by model', async () => {
    const { pricingRows, replaceOverride } = await import('@/features/usage/logic');
    const price = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 };
    const overrides = [
      { model: 'GPT-X', input: 3, output: 4 },
      { model: 'unused', input: 5, output: 6, cacheRead: 0.5 },
    ];
    const rows = pricingRows(
      [
        { model: 'gpt-x', source: 'override', price: { ...price, input: 3 } },
        { model: 'other', source: 'models.dev', price },
      ],
      overrides
    );
    expect(rows.map((r) => [r.model, r.override?.model ?? null])).toEqual([
      ['gpt-x', 'GPT-X'],
      ['other', null],
      ['unused', 'unused'],
    ]);
    // An override for a model without usage yet shows its own price, cache write defaulting to input.
    expect(rows[2].price).toEqual({ input: 5, output: 6, cacheRead: 0.5, cacheWrite: 5 });

    const next = { model: 'gpt-x', input: 7, output: 8 };
    expect(replaceOverride(overrides, 'gpt-x', next)).toEqual([overrides[1], next]);
    expect(replaceOverride(overrides, '', { model: 'Unused', input: 1, output: 1 })).toEqual([
      overrides[0],
      { model: 'Unused', input: 1, output: 1 },
    ]);
    expect(replaceOverride(overrides, 'unused', null)).toEqual([overrides[0]]);

    // Case variants of one model show as one row with the last variant, as the backend applies it.
    const variants = [
      { model: 'Solo', input: 1, output: 1 },
      { model: 'solo', input: 2, output: 2 },
    ];
    const solo = pricingRows([], variants);
    expect(solo).toHaveLength(1);
    expect(solo[0].override).toBe(variants[1]);
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
    expect(rt.inFlightRequests).toEqual([]);
  });

  test('normalizes in-flight requests', async () => {
    const { normalizeUsageRealtime } = await import('@/services/api/usageStore');
    const rt = normalizeUsageRealtime({
      in_flight: 2,
      in_flight_requests: [
        {
          id: 7,
          request_id: 'req-7',
          started_at: 1000,
          elapsed_ms: 2500,
          endpoint: 'POST /v1/responses',
          transport: 'sse',
          provider: 'codex',
          model: 'gpt-x',
          auth_index: 'a1',
          api_key_id: 'abc',
          api_key: 'sk-...xyz',
        },
        { id: 8, endpoint: 'POST /v1/messages/count_tokens' },
        'junk',
      ],
    });
    expect(rt.inFlight).toBe(2);
    expect(rt.inFlightRequests).toHaveLength(2);
    expect(rt.inFlightRequests[0]).toEqual({
      id: 7,
      requestId: 'req-7',
      startedAt: 1000,
      elapsedMs: 2500,
      endpoint: 'POST /v1/responses',
      transport: 'sse',
      provider: 'codex',
      model: 'gpt-x',
      authIndex: 'a1',
      apiKeyId: 'abc',
      apiKey: 'sk-...xyz',
    });
    expect(rt.inFlightRequests[1]).toMatchObject({ id: 8, model: '', provider: '', elapsedMs: 0 });
  });

  test('drops in-flight HTTP calls whose event is already in the feed', async () => {
    const { visibleInFlight } = await import('@/features/usage/logic');
    const inFlight = [
      { id: 1, requestId: 'done', transport: 'sse' },
      { id: 2, requestId: 'running', transport: 'http' },
      { id: 3, requestId: 'done', transport: 'ws' },
      { id: 4, requestId: '', transport: 'http' },
    ];
    const feed = [{ requestId: 'done' }, { requestId: '' }];
    expect(visibleInFlight(inFlight, feed).map((r) => r.id)).toEqual([2, 3, 4]);
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

describe('usage precision, transport and cells', () => {
  test('normalizes stats precision, recorded transport and in-flight', async () => {
    const { normalizeUsageStats, normalizeUsageEvents, normalizeUsageRealtime } =
      await import('@/services/api/usageStore');
    const stats = normalizeUsageStats({ exact: true, partial: true });
    expect([stats.exact, stats.partial]).toEqual([true, true]);
    expect(normalizeUsageStats({}).exact).toBe(false);
    expect(normalizeUsageEvents({ events: [{ id: 1, transport: 'ws' }] }).events[0].transport).toBe(
      'ws'
    );
    expect(normalizeUsageRealtime({ in_flight: 3 }).inFlight).toBe(3);
  });

  test('prefers the recorded transport over the endpoint inference', async () => {
    const { eventTransport } = await import('@/features/usage/logic');
    expect(eventTransport('POST /v1/responses', false, 'ws')).toBe('ws');
    expect(eventTransport('GET /v1/responses', false, 'http')).toBe('http');
    expect(eventTransport('GET /v1/responses', false, 'bogus')).toBe('ws');
  });

  test('dense cells put the key figure first and details below', async () => {
    const { EventLatencyCell, EventStatusCell, EventTokensCell } =
      await import('@/features/usage/components/EventCells');
    const event = normalizeUsageEvents({
      events: [
        {
          id: 1,
          endpoint: 'POST /v1/chat/completions',
          stream: true,
          status_code: 200,
          tokens: {
            input_uncached: 250,
            cache_read: 750,
            cache_write: 0,
            output: 300,
            reasoning: 80,
          },
        },
      ],
    }).events[0];
    const status = renderToStaticMarkup(createElement(EventStatusCell, { event }));
    expect(status).toContain('SSE');
    expect(status).toContain('POST /v1/chat/completions');
    const tokens = renderToStaticMarkup(createElement(EventTokensCell, { event }));
    expect(tokens).toContain('<span title="1,000">1K</span> → <span>300</span>');
    expect(tokens).toContain('75%');
    expect(tokens).toContain('80');
    const latency = (outputTps: number) =>
      renderToStaticMarkup(
        createElement(EventLatencyCell, {
          event: { ...event, latencyMs: 2000, ttftMs: 500, outputTps },
        })
      );
    expect(latency(85.25)).toContain('85.3 t/s');
    expect(latency(0)).not.toContain('t/s');
  });
});

describe('usage table sorting and CSV', () => {
  test('cycles a column through its natural direction, the reverse and the default', () => {
    expect(nextSort(null, 'cost')).toEqual({ key: 'cost', dir: 'desc' });
    expect(nextSort({ key: 'cost', dir: 'desc' }, 'cost')).toEqual({ key: 'cost', dir: 'asc' });
    expect(nextSort({ key: 'cost', dir: 'asc' }, 'cost')).toBeNull();
    expect(nextSort({ key: 'cost', dir: 'asc' }, 'model', true)).toEqual({
      key: 'model',
      dir: 'asc',
    });
    expect(nextSort({ key: 'model', dir: 'desc' }, 'model', true)).toBeNull();
  });

  test('sorts stably with missing values last in both directions', () => {
    const rows = [
      { id: 'a', v: 2 },
      { id: 'b', v: null },
      { id: 'c', v: 5 },
      { id: 'd', v: 2 },
    ];
    const ids = (dir: 'asc' | 'desc') => sortRows(rows, (r) => r.v, dir).map((r) => r.id);
    expect(ids('desc')).toEqual(['c', 'a', 'd', 'b']);
    expect(ids('asc')).toEqual(['a', 'd', 'c', 'b']);
    expect(sortRows(rows, undefined, 'asc')).toEqual(rows);
    expect(sortRows([{ n: 'b' }, { n: 'a' }], (r) => r.n, 'asc')[0].n).toBe('a');
  });

  test('writes quoted, formula-safe CSV with a BOM', () => {
    expect(
      toCsv([
        ['Model', 'n'],
        ['a,"b"', -3],
        ['=cmd', 1.5],
      ])
    ).toBe('\uFEFFModel,n\r\n"a,""b""",-3\r\n\'=cmd,1.5\r\n');
  });

  test('sort headers expose their state to assistive tech', () => {
    const markup = renderToStaticMarkup(
      createElement(SortHead, {
        label: 'Cost',
        sortKey: 'cost',
        sort: { key: 'cost', dir: 'desc' },
        onSort: () => {},
      })
    );
    expect(markup).toContain('aria-sort="descending"');
    expect(markup).toContain('<button type="button"');
  });
});

describe('usage cache savings', () => {
  test('prices cache reads at the input minus cache-read price per million tokens', () => {
    const price = (input: number, cacheRead: number) => ({
      input,
      output: 0,
      cacheRead,
      cacheWrite: input,
    });
    const saved = cacheSavings(
      [
        { model: 'a', tokens: { cacheRead: 2_000_000 } },
        { model: 'a', tokens: { cacheRead: 1_000_000 } },
        { model: 'unpriced', tokens: { cacheRead: 5_000_000 } },
        { model: 'odd', tokens: { cacheRead: 1_000_000 } },
      ],
      [
        { model: 'a', source: 'override', price: price(3, 0.3) },
        { model: 'unpriced', source: '', price: null },
        { model: 'odd', source: 'override', price: price(1, 2) },
      ]
    );
    expect(saved).toBeCloseTo(8.1);
    expect(cacheSavings([], [])).toBe(0);
  });
});

describe('usage previous-period alignment', () => {
  test('aligns previous buckets from the trailing edge', () => {
    // Equal length
    expect(alignPrevious(['c0', 'c1', 'c2'], ['p0', 'p1', 'p2'])).toEqual(['p0', 'p1', 'p2']);

    // One extra leading previous bucket (e.g. floored window start)
    expect(alignPrevious(['c0', 'c1', 'c2'], ['extra', 'p0', 'p1', 'p2'])).toEqual([
      'p0',
      'p1',
      'p2',
    ]);

    // Shorter previous
    expect(alignPrevious(['c0', 'c1', 'c2'], ['p1', 'p2'])).toEqual([undefined, 'p1', 'p2']);
  });
});

describe('usage overview', () => {
  test('renders eight headline cards, sortable tables and the comparison toggle', () => {
    const stats = normalizeUsageStats({
      from: 0,
      to: 3600,
      bucket: 'hour',
      totals: { ...aggregate(1500, 5, 12.5), unpriced_requests: 0 },
      series: [{ time: 0, ...aggregate(1500, 5, 12.5) }],
      models: [{ model: 'gpt-5', provider: 'codex', ...aggregate(1500, 5, 12.5) }],
    });
    const markup = renderToStaticMarkup(
      createElement(OverviewTab, {
        stats,
        prevStats: stats,
        prices: [],
        labels: { credential: (authIndex: string) => authIndex, keyName: () => null },
        onOpenEvents: () => {},
        onDrillDown: () => {},
      })
    );
    expect(markup.match(/style="--accent:/g)?.length).toBe(8);
    expect(markup).toContain('title="1,500"');
    expect(markup).toContain('aria-sort="none"');
    expect(markup).toContain('aria-pressed="false"');
  });
});

describe('usage preferences', () => {
  test('keeps only valid remembered choices', () => {
    expect(
      parseUsagePrefs(
        JSON.stringify({
          tab: 'analysis',
          range: '7d',
          metric: 'cost',
          autoRefresh: 60,
          comparePrevious: true,
        })
      )
    ).toEqual({
      tab: 'analysis',
      range: '7d',
      metric: 'cost',
      autoRefresh: 60,
      comparePrevious: true,
    });
    expect(
      parseUsagePrefs(
        JSON.stringify({
          tab: 'nope',
          range: 'custom',
          metric: 1,
          autoRefresh: 7,
          comparePrevious: 'y',
        })
      )
    ).toEqual({});
    expect(parseUsagePrefs('{broken')).toEqual({});
    expect(parseUsagePrefs(null)).toEqual({});
    expect(parseUsagePrefs('42')).toEqual({});
  });
});

describe('usage motion', () => {
  test('CountUp starts from zero and formats hundredths', async () => {
    const { CountUp } = await import('@/features/usage/components/Motion');
    // Static render is the first frame: the roll-up to the value happens after mount.
    expect(renderToStaticMarkup(createElement(CountUp, { value: 5.64, format: formatCost }))).toBe(
      '$0'
    );
    expect(
      renderToStaticMarkup(createElement(CountUp, { value: Number.NaN, format: formatCompact }))
    ).toBe('0');
  });
});
