import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '@/i18n';
import {
  isUsageStoreDisabled,
  normalizeClientGeo,
  normalizeUsageEvents,
  normalizeUsagePricing,
  normalizeUsageStats,
} from '@/services/api/usageStore';
import {
  alignPrevious,
  clientKeyEntries,
  clientKeyId,
  emptyGlobalFilter,
  eventCostPerMillion,
  eventErrorSummary,
  filterMultiSelectOptions,
  formatClientGeoLine,
  formatDetailIsp,
  formatDetailLocation,
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
  serializeGlobalFilterToSearchParams,
  toEventsQuery,
  withSelectedOption,
} from '@/features/usage/logic';
import {
  cacheHitRate,
  changePercent,
  costPerMillionTokens,
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
          risk: 'model_reroute',
          risk_prompt: '[user] scan this host',
          risk_reason: 'flagged',
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
      risk: 'model_reroute',
      riskPrompt: '[user] scan this host',
      riskReason: 'flagged',
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
    expect(totals.cacheableInput).toBeUndefined();
    expect(cacheHitRate(totals)).toBe(40);
    // Input of models without prompt caching stays out of the hit rate.
    const cacheable = normalizeUsageStats({
      totals: { ...aggregate(1, 0, 0), cacheable_input: 500 },
    }).totals;
    expect(cacheHitRate(cacheable)).toBe(80);
    expect(cacheHitRate({ ...cacheable, cacheableInput: 0 })).toBeNull();
    const four = normalizeUsageStats({
      totals: { ...aggregate(4, 0, 0.9), unpriced_requests: 1 },
    }).totals;
    expect(tokensPerRequest(four)).toBe(300);
    expect(costPerRequest(four)).toBeCloseTo(0.3);
    expect(costPerRequest({ ...four, unpricedRequests: 4 })).toBeNull();
    // Partially priced: the unpriced requests' tokens are unknown, so no rate.
    expect(costPerMillionTokens(four)).toBeNull();
    expect(costPerMillionTokens({ ...four, unpricedRequests: 4 })).toBeNull();
    const fullyPriced = { ...four, unpricedRequests: 0 };
    // 0.9 USD over 1200 tokens.
    expect(costPerMillionTokens(fullyPriced)).toBeCloseTo(750);
    expect(
      costPerMillionTokens({ ...fullyPriced, tokens: { ...fullyPriced.tokens, total: 0 } })
    ).toBeNull();
    expect(costPerMillionTokens({ ...fullyPriced, requests: 0 })).toBeNull();
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

  test('builds event queries', () => {
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
    expect(toEventsQuery(window, globalFilter, 'risk')).toMatchObject({
      risk: true,
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
          risk: '',
          riskReason: '',
          riskPrompt: '',
        },
        labels: { credential: () => 'cred', keyName: () => 'key' },
        onClose: () => {},
      })
    );
    expect(markup).toContain('modal-overlay');
    expect(markup).toContain('gpt-5');
  });

  test('EventDetailModal shows the risk type and flagged prompt', async () => {
    const i18n = (await import('@/i18n')).default;
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
          risk: 'cyber_policy',
          riskReason: 'blocked under the Usage Policy',
          riskPrompt: '[user] find CVEs in this binary',
        },
        labels: { credential: () => 'cred', keyName: () => 'key' },
        onClose: () => {},
      })
    );
    expect(markup).toContain(i18n.t('usage_stats.risk_type_cyber_policy'));
    expect(markup).toContain(i18n.t('usage_stats.detail_risk_prompt'));
    expect(markup).toContain('blocked under the Usage Policy');
    expect(markup).toContain('find CVEs in this binary');
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

  test('folds WebSocket turns of one connection into one row', async () => {
    const { groupWebsocketEvents, toggleInSet } = await import('@/features/usage/logic');
    const { events } = normalizeUsageEvents({
      events: [
        {
          id: 6,
          request_id: 'ws1',
          transport: 'ws',
          model: 'm2',
          cost: 1,
          priced: true,
          latency_ms: 300,
          tokens: { output: 5 },
          failed: true,
          status_code: 500,
        },
        { id: 5, request_id: 'h1', transport: 'sse' },
        {
          id: 4,
          request_id: 'ws1',
          transport: 'ws',
          model: 'm1',
          cost: 2,
          priced: true,
          latency_ms: 100,
          tokens: { output: 7 },
        },
        { id: 3, request_id: 'ws2', transport: 'ws' },
        { id: 2, request_id: 'h1', transport: 'sse' },
        { id: 1, request_id: '', transport: 'ws' },
      ],
    });
    const items = groupWebsocketEvents(events);
    expect(items.map((i) => (i.kind === 'group' ? `g:${i.group.requestId}` : i.event.id))).toEqual([
      'g:ws1',
      5,
      3,
      2,
      1,
    ]);
    const group = items[0].kind === 'group' ? items[0].group : null;
    expect(group?.events.map((e) => e.id)).toEqual([6, 4]);
    expect(group?.failed).toBe(1);
    expect(group?.summary).toMatchObject({ id: 6, model: 'm2', cost: 3, latencyMs: 200 });
    expect(group?.summary.tokens.output).toBe(12);
    // An open connection with one turn still gets its own row.
    expect(groupWebsocketEvents(events, new Set(['ws2']))[2].kind).toBe('group');
    expect([...toggleInSet(toggleInSet(new Set<string>(), 'a'), 'a')]).toEqual([]);
  });
});

describe('usage event cells', () => {
  test('derives the downstream transport and cache hit rate', async () => {
    const { eventTransport, eventCacheHitRate, EVENT_COLUMNS } =
      await import('@/features/usage/logic');
    expect(eventTransport('GET /v1/responses', true)).toBe('ws');
    expect(eventTransport('get /v1/realtime', false)).toBe('ws');
    expect(eventTransport('POST /v1/chat/completions', true)).toBe('sse');
    expect(eventTransport('POST /v1/chat/completions', false)).toBe('http');
    expect(eventTransport('', false)).toBe('http');
    expect(eventCacheHitRate({ inputUncached: 25, cacheRead: 75, cacheWrite: 0 })).toBe(75);
    expect(eventCacheHitRate({ inputUncached: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull();
    expect(EVENT_COLUMNS).not.toContain('tier');
    expect(EVENT_COLUMNS).toContain('client');
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
    expect(event.cacheable).toBeUndefined();
    const plainTokens = renderToStaticMarkup(
      createElement(EventTokensCell, {
        event: { ...event, tokens: { ...event.tokens, cacheRead: 0 }, cacheable: false },
      })
    );
    expect(plainTokens).not.toContain('0%');
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
    expect(markup.match(/<div class="card\b/g)?.length).toBe(8);
    expect(markup).not.toContain('--accent');
    expect(markup).toContain('title="1,500"');
    expect(markup).toContain('aria-sort="none"');
    expect(markup).toContain('aria-pressed="false"');
  });
});

describe('usage auto-refresh', () => {
  test('prices load once per page; only explicit reloads refetch them', () => {
    const page = readFileSync('src/features/usage/UsagePage.tsx', 'utf8');
    expect(page).toContain('if (!document.hidden) void load(false);');
    expect(page).toContain('refreshPricing ? usageStoreApi.getPricing() : Promise.resolve(null)');
    // Filter changes fetch prices only until they have loaded once.
    expect(page).toContain('void load(!pricingLoadedRef.current);');
    expect(page).toContain('useHeaderRefresh(handleHeaderRefresh);');
  });

  test('keeps store settings on their own tab, not the pricing tab', () => {
    const page = readFileSync('src/features/usage/UsagePage.tsx', 'utf8');
    const pricing = readFileSync('src/features/usage/tabs/PricingTab.tsx', 'utf8');
    expect(page).toContain("tab === 'settings' && (");
    expect(page).toContain('<StoreSettingsCard');
    expect(pricing).not.toContain('StoreSettingsCard');
  });

  test('keys StorageCard by revision, disables it while settings save, and bumps revision on finish', () => {
    const page = readFileSync('src/features/usage/UsagePage.tsx', 'utf8');
    const storeCard = readFileSync('src/features/usage/components/StoreSettingsCard.tsx', 'utf8');
    expect(page).toContain('<StorageCard key={storageRev} disabled={settingsSaving} />');
    expect(page).toContain('const [settingsSaving, setSettingsSaving] = useState(false);');
    expect(page).toContain('if (!saving) bumpStorageRev();');
    expect(page).toContain('const handleHeaderRefresh = useCallback(async () => {');
    expect(page).toContain('bumpStorageRev();');
    expect(page).toContain('useHeaderRefresh(handleHeaderRefresh);');
    expect(storeCard).toContain('onSavingChange?.(true);');
    expect(storeCard).toContain('onSavingChange?.(false);');
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
    expect(parseUsagePrefs(JSON.stringify({ tab: 'settings' }))).toEqual({ tab: 'settings' });
    expect(parseUsagePrefs(JSON.stringify({ metric: 'combined' }))).toEqual({
      metric: 'combined',
    });
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

describe('usage store settings', () => {
  test('normalizes and serializes observability.usage.store settings', async () => {
    const { MAX_RETENTION_DAYS, normalizeUsageStoreSettings, serializeUsageStoreSettings } =
      await import('@/services/api/usageStore');

    expect(normalizeUsageStoreSettings(null)).toEqual({
      enable: false,
      path: '',
      retentionDays: 0,
      disableGeoip: false,
      disableRiskPrompts: false,
      excludeEmbeddings: false,
    });

    const loaded = normalizeUsageStoreSettings(
      {
        enable: true,
        path: '  /data/usage.db  ',
        'retention-days': 14,
        pricing: {
          'disable-models-dev': true,
          overrides: [{ model: 'gpt-5', input: 1, output: 2 }],
        },
        geoip: { disable: true },
        'risk-prompts': { disable: true },
      },
      true
    );
    expect(loaded).toEqual({
      enable: true,
      path: '/data/usage.db',
      retentionDays: 14,
      disableGeoip: true,
      disableRiskPrompts: true,
      excludeEmbeddings: true,
    });
    expect(normalizeUsageStoreSettings({ 'retention-days': -1 }).retentionDays).toBe(-1);

    const defaults = normalizeUsageStoreSettings({});
    expect(serializeUsageStoreSettings(loaded, defaults)).toEqual({
      patch: {
        enable: true,
        path: '/data/usage.db',
        'retention-days': 14,
        geoip: { disable: true },
        'risk-prompts': { disable: true },
      },
      // exclude-embeddings sits beside the store subtree, so it is set by its own path.
      puts: { '/config/observability/usage/exclude-embeddings': true },
      deletions: [],
    });

    // Clearing optional fields deletes them cleanly without touching overrides or enable.
    expect(
      serializeUsageStoreSettings(
        {
          enable: true,
          path: '',
          retentionDays: 0,
          disableGeoip: false,
          disableRiskPrompts: false,
          excludeEmbeddings: false,
        },
        loaded
      )
    ).toEqual({
      patch: {},
      puts: {},
      deletions: [
        '/config/observability/usage/store/path',
        '/config/observability/usage/store/retention-days',
        '/config/observability/usage/store/geoip/disable',
        '/config/observability/usage/store/risk-prompts/disable',
        '/config/observability/usage/exclude-embeddings',
      ],
    });

    // pricing.disable-models-dev is YAML-only now: no save ever writes or deletes it.
    for (const next of [
      { ...loaded, retentionDays: 7 },
      { ...loaded, path: '' },
      {
        enable: false,
        path: '',
        retentionDays: 0,
        disableGeoip: false,
        disableRiskPrompts: false,
        excludeEmbeddings: false,
      },
    ]) {
      for (const previous of [loaded, defaults, undefined]) {
        const mutation = serializeUsageStoreSettings(next, previous);
        expect(mutation.patch).not.toHaveProperty('pricing');
        expect(mutation.deletions.some((p) => p.includes('pricing'))).toBe(false);
      }
    }

    // Disabling keeps path, retention-days and pricing intact on disk.
    expect(serializeUsageStoreSettings({ ...loaded, enable: false }, loaded)).toEqual({
      patch: { enable: false },
      puts: {},
      deletions: [],
    });

    expect(() => serializeUsageStoreSettings({ ...defaults, retentionDays: 1.5 })).toThrow(
      RangeError
    );
    expect(() =>
      serializeUsageStoreSettings({ ...defaults, retentionDays: MAX_RETENTION_DAYS + 1 })
    ).toThrow(RangeError);
  });

  test('orders PATCH and DELETE safely when enabling vs disabling and tolerates 404 on DELETE', async () => {
    const { apiClient } = await import('@/services/api/client');
    const { usageStoreApi } = await import('@/services/api/usageStore');

    const origPatch = apiClient.patch.bind(apiClient);
    const origDelete = apiClient.delete.bind(apiClient);
    const origPut = apiClient.put.bind(apiClient);
    const calls: string[] = [];

    apiClient.patch = (async (url: string, data?: unknown) => {
      calls.push(`PATCH ${url} ${JSON.stringify(data)}`);
      return { status: 'ok' } as never;
    }) as typeof apiClient.patch;
    apiClient.delete = (async (url: string) => {
      calls.push(`DELETE ${url}`);
      throw { status: 404, apiCode: 'not_found' };
    }) as typeof apiClient.delete;
    apiClient.put = (async (url: string, data?: unknown) => {
      calls.push(`PUT ${url} ${JSON.stringify(data)}`);
      return { status: 'ok' } as never;
    }) as typeof apiClient.put;

    try {
      // Enabling while clearing path: DELETE runs before PATCH enable=true, 404 ignored.
      await usageStoreApi.saveSettings(
        {
          enable: true,
          path: '',
          retentionDays: 30,
          disableGeoip: false,
          disableRiskPrompts: false,
          excludeEmbeddings: false,
        },
        {
          enable: false,
          path: '/old.db',
          retentionDays: 30,
          disableGeoip: false,
          disableRiskPrompts: false,
          excludeEmbeddings: false,
        }
      );
      expect(calls).toEqual([
        'DELETE /config/observability/usage/store/path',
        'PATCH /config/observability/usage/store {"enable":true}',
      ]);

      // Disabling while clearing path: PATCH enable=false runs before DELETE.
      calls.length = 0;
      await usageStoreApi.saveSettings(
        {
          enable: false,
          path: '',
          retentionDays: 30,
          disableGeoip: false,
          disableRiskPrompts: false,
          excludeEmbeddings: false,
        },
        {
          enable: true,
          path: '/old.db',
          retentionDays: 30,
          disableGeoip: false,
          disableRiskPrompts: false,
          excludeEmbeddings: false,
        }
      );
      expect(calls).toEqual([
        'PATCH /config/observability/usage/store {"enable":false}',
        'DELETE /config/observability/usage/store/path',
      ]);

      // Disabling while clearing path and setting exclude-embeddings:
      // PATCH enable:false, then DELETE path, then PUT exclude-embeddings.
      calls.length = 0;
      await usageStoreApi.saveSettings(
        {
          enable: false,
          path: '',
          retentionDays: 30,
          disableGeoip: false,
          disableRiskPrompts: false,
          excludeEmbeddings: true,
        },
        {
          enable: true,
          path: '/old.db',
          retentionDays: 30,
          disableGeoip: false,
          disableRiskPrompts: false,
          excludeEmbeddings: false,
        }
      );
      expect(calls).toEqual([
        'PATCH /config/observability/usage/store {"enable":false}',
        'DELETE /config/observability/usage/store/path',
        'PUT /config/observability/usage/exclude-embeddings true',
      ]);
    } finally {
      apiClient.patch = origPatch;
      apiClient.delete = origDelete;
      apiClient.put = origPut;
    }
  });

  test('validates retention-days drafts and tracks dirty state', async () => {
    const {
      isStoreSettingsDirty,
      parseRetentionDays,
      parseStoreSettingsDraft,
      toStoreSettingsDraft,
    } = await import('@/features/usage/logic');

    expect(parseRetentionDays('')).toBe(0);
    expect(parseRetentionDays(' 0 ')).toBe(0);
    expect(parseRetentionDays('30')).toBe(30);
    expect(parseRetentionDays('-1')).toBe(-1);
    expect(parseRetentionDays('1.5')).toBeNull();
    expect(parseRetentionDays('1e2')).toBeNull();
    expect(parseRetentionDays('abc')).toBeNull();
    expect(parseRetentionDays('999999')).toBeNull();

    const saved = {
      enable: true,
      path: '/data/usage.db',
      retentionDays: 0,
      disableGeoip: false,
    };
    const draft = toStoreSettingsDraft(saved);
    expect(draft).toEqual({
      enable: true,
      path: '/data/usage.db',
      retentionDays: '',
      disableGeoip: false,
    });
    expect(isStoreSettingsDirty(draft, saved)).toBe(false);
    expect(isStoreSettingsDirty({ ...draft, disableGeoip: true }, saved)).toBe(true);
    expect(isStoreSettingsDirty({ ...draft, retentionDays: '0' }, saved)).toBe(false);
    expect(isStoreSettingsDirty({ ...draft, retentionDays: '30' }, saved)).toBe(true);
    expect(isStoreSettingsDirty({ ...draft, retentionDays: 'bad' }, saved)).toBe(true);
    expect(parseStoreSettingsDraft({ ...draft, retentionDays: 'bad' })).toEqual({
      error: 'retentionDays',
    });
    expect(parseStoreSettingsDraft({ ...draft, path: ' /x.db ', retentionDays: '-1' })).toEqual({
      settings: { enable: true, path: '/x.db', retentionDays: -1, disableGeoip: false },
    });
  });

  test('renders StoreSettingsCard with accessible controls and synchronized locales', async () => {
    const { StoreSettingsCard } = await import('@/features/usage/components/StoreSettingsCard');
    const markup = renderToStaticMarkup(
      createElement(StoreSettingsCard, {
        initialSettings: {
          enable: true,
          path: '/var/lib/usage.db',
          retentionDays: 90,
          disableGeoip: true,
          disableRiskPrompts: false,
          excludeEmbeddings: true,
        },
        onSaved: async () => {},
      })
    );
    expect(markup).toContain('value="/var/lib/usage.db"');
    expect(markup).toContain('value="90"');
    expect(markup.match(/<input type="checkbox"/g)?.length).toBe(4);
    expect(markup.match(/<input type="checkbox"[^>]*checked=""/g)?.length).toBe(3);
    expect(markup).not.toContain('models.dev');
    expect(markup).toContain('https://ip.sb/api/');
    expect(markup).not.toContain('db-ip');
    expect(markup).toContain('aria-describedby=');

    const locales = ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko'] as const;
    const maps = await Promise.all(
      locales.map(async (loc) => {
        const json = (await Bun.file(`src/i18n/locales/${loc}.json`).json()) as {
          usage_stats: Record<string, string>;
        };
        return [loc, Object.keys(json.usage_stats).sort()] as const;
      })
    );
    const baseline = maps[0][1];
    for (const [, keys] of maps.slice(1)) {
      expect(keys).toEqual(baseline);
    }
  });

  test('normalizes the IP lookup status and shows background progress without a lookup button', async () => {
    const { normalizeUsageGeoipStatus, usageStoreApi } = await import('@/services/api/usageStore');
    const { StoreSettingsCard } = await import('@/features/usage/components/StoreSettingsCard');
    const i18n = (await import('@/i18n')).default;
    const background = i18n.t('usage_stats.store_geoip_background');

    expect(normalizeUsageGeoipStatus(null)).toEqual({
      enabled: true,
      provider: '',
      resolved: 0,
      pending: 0,
      lastLookupAt: null,
      lastError: '',
    });
    expect(normalizeUsageGeoipStatus({ resolved: -3, pending: 2.7 })).toMatchObject({
      resolved: 0,
      pending: 2,
    });
    expect(usageStoreApi).not.toHaveProperty('refreshGeoip');

    const settings = {
      enable: true,
      path: '',
      retentionDays: 0,
      disableGeoip: false,
      disableRiskPrompts: false,
    };
    const status = (pending: number, enabled = true) => ({
      enabled,
      provider: 'ip.sb',
      resolved: 3,
      pending,
      lastLookupAt: null,
      lastError: '',
    });
    const render = (pending: number, disableGeoip = false, enabled = true) =>
      renderToStaticMarkup(
        createElement(StoreSettingsCard, {
          initialSettings: { ...settings, disableGeoip },
          initialGeoipStatus: status(pending, enabled),
          onSaved: async () => {},
        })
      );

    const busy = render(5);
    expect(busy).toContain(background);
    // Only the save button remains in the card; no manual lookup action.
    expect(busy.match(/<button/g)?.length).toBe(1);
    expect(render(0)).not.toContain(background);
    // The note follows the backend-reported status, not the unsaved switch.
    expect(render(5, true, true)).toContain(background);
    expect(render(5, false, false)).not.toContain(background);
  });

  test('renders StatCard on the shared Card surface without inline accent or gradient styles', async () => {
    const { METRIC_ACCENTS, SERIES_COLORS } = await import('@/features/usage/charts');
    const { StatCard } = await import('@/features/usage/components/StatCard');

    expect(SERIES_COLORS).toHaveLength(8);
    for (const color of [...Object.values(METRIC_ACCENTS), ...SERIES_COLORS]) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }

    const markup = renderToStaticMarkup(
      createElement(StatCard, {
        accent: 'cost',
        label: 'Estimated cost',
        value: '$12.40',
        change: -8.2,
        goodWhenUp: false,
        spark: [2, 5, 4],
      })
    );

    expect(markup).toMatch(
      /<div(?:\s+class="[^"]*")?\s+data-reveal="">\s*<div class="card\b[^"]*">/
    );
    expect(markup).not.toMatch(/<div class="card\b[^"]*"[^>]*\bstyle=/);
    expect(markup).not.toContain('--accent');
    expect(markup).not.toContain('gradient');
    expect(markup).toContain(`background-color:${METRIC_ACCENTS.cost}`);
    expect(markup).toContain(`stroke="${METRIC_ACCENTS.cost}"`);
    expect(markup).toContain('aria-label=');
  });

  test('normalizes client_geo and formats location and ISP', async () => {
    // Missing / invalid
    expect(normalizeClientGeo(undefined)).toBeUndefined();
    expect(normalizeClientGeo(null)).toBeUndefined();
    expect(normalizeClientGeo({})).toBeUndefined();
    expect(normalizeClientGeo('string')).toBeUndefined();
    expect(normalizeClientGeo(42)).toBeUndefined();

    // Scopes
    expect(normalizeClientGeo({ scope: 'private' })).toEqual({ scope: 'private' });
    expect(normalizeClientGeo({ scope: 'loopback' })).toEqual({ scope: 'loopback' });
    expect(normalizeClientGeo({ scope: 'PRIVATE' })).toEqual({ scope: 'private' });

    // Full public
    const full = normalizeClientGeo({
      scope: 'public',
      country_code: 'JP',
      country: 'Japan',
      region: 'Tokyo',
      city: 'Tokyo',
      asn: 4713.9,
      isp: 'NTT Communications Corporation',
    });
    expect(full).toEqual({
      scope: 'public',
      countryCode: 'JP',
      country: 'Japan',
      region: 'Tokyo',
      city: 'Tokyo',
      asn: 4713,
      isp: 'NTT Communications Corporation',
    });

    // Partial and invalid ASN
    expect(normalizeClientGeo({ country_code: 'US', asn: -5 })).toEqual({
      scope: 'public',
      countryCode: 'US',
    });
    expect(normalizeClientGeo({ city: 'London', asn: 'abc' })).toEqual({
      scope: 'public',
      city: 'London',
    });

    // eventErrorSummary / eventCostPerMillion
    expect(eventErrorSummary('')).toBe('');
    expect(
      eventErrorSummary('{"error":{"type":"usage_limit_reached","message":"limit reached"}}')
    ).toBe('limit reached');
    expect(eventErrorSummary('{"error":"bad key"}')).toBe('bad key');
    expect(eventErrorSummary('{"message":"top level"}')).toBe('top level');
    expect(eventErrorSummary('upstream reset\nstack...')).toBe('upstream reset');
    expect(eventErrorSummary('[1,2]')).toBe('[1,2]');
    expect(eventCostPerMillion({ priced: true, cost: 0.5, tokens: { total: 250_000 } })).toBe(2);
    expect(eventCostPerMillion({ priced: false, cost: 0.5, tokens: { total: 1 } })).toBeNull();
    expect(eventCostPerMillion({ priced: true, cost: 0, tokens: { total: 0 } })).toBeNull();

    // formatClientGeoLine
    expect(formatClientGeoLine(undefined)).toBe('');
    expect(formatClientGeoLine({ scope: 'private' })).toBe('Private network');
    expect(
      formatClientGeoLine({ scope: 'private' }, 'zh-CN', (k) =>
        k === 'usage_stats.client_scope_private' ? '局域网' : k
      )
    ).toBe('局域网');
    expect(formatClientGeoLine({ scope: 'private', isp: 'Internal' })).toBe('Private network');
    expect(formatClientGeoLine({ scope: 'loopback' })).toBe('Loopback');
    expect(
      formatClientGeoLine({ scope: 'loopback' }, 'zh-CN', (k) =>
        k === 'usage_stats.client_scope_loopback' ? '本机' : k
      )
    ).toBe('本机');
    expect(formatClientGeoLine({ scope: 'loopback', isp: 'Local' })).toBe('Loopback');

    // Public variations
    expect(
      formatClientGeoLine({
        scope: 'public',
        country: 'Japan',
        city: 'Tokyo',
        isp: 'NTT',
      })
    ).toBe('Japan, Tokyo · NTT');
    expect(formatClientGeoLine({ scope: 'public', country: 'Japan', city: 'Tokyo' })).toBe(
      'Japan, Tokyo'
    );
    expect(formatClientGeoLine({ scope: 'public', country: 'Japan', isp: 'NTT' })).toBe(
      'Japan · NTT'
    );
    expect(formatClientGeoLine({ scope: 'public', country: 'Japan' })).toBe('Japan');
    expect(
      formatClientGeoLine({ scope: 'public', country: 'Japan', region: 'Kanto', isp: 'NTT' })
    ).toBe('Japan, Kanto · NTT');
    expect(formatClientGeoLine({ scope: 'public', region: 'Kanto' })).toBe('Kanto');
    expect(formatClientGeoLine({ scope: 'public', city: 'Tokyo' })).toBe('Tokyo');
    expect(formatClientGeoLine({ scope: 'public', isp: 'NTT' })).toBe('NTT');
    // The organization wins over the ISP.
    expect(
      formatClientGeoLine({
        scope: 'public',
        country: 'Japan',
        city: 'Sapporo',
        isp: 'NTT Communications Corporation',
        org: 'Open Computer Network',
      })
    ).toBe('Japan, Sapporo · Open Computer Network');
    expect(normalizeClientGeo({ scope: 'public', org: ' Open Computer Network ' })).toEqual({
      scope: 'public',
      org: 'Open Computer Network',
    });

    // Intl DisplayNames region localization
    expect(
      formatClientGeoLine(
        { scope: 'public', countryCode: 'JP', country: 'Japan', city: 'Tokyo', isp: 'NTT' },
        'zh-CN'
      )
    ).toBe('日本, Tokyo · NTT');
    expect(
      formatClientGeoLine(
        { scope: 'public', countryCode: 'INVALID', country: 'Fallback', city: 'City' },
        'zh-CN'
      )
    ).toBe('Fallback, City');

    // formatDetailLocation & formatDetailIsp
    expect(formatDetailLocation(undefined)).toBe('');
    expect(formatDetailLocation({ scope: 'private' })).toBe('Private network');
    expect(formatDetailLocation({ scope: 'loopback' })).toBe('Loopback');
    expect(
      formatDetailLocation(
        { scope: 'public', countryCode: 'JP', country: 'Japan', region: 'Tokyo', city: 'Tokyo' },
        'zh-CN'
      )
    ).toBe('日本, Tokyo');
    expect(
      formatDetailLocation({
        scope: 'public',
        country: 'United States',
        region: 'California',
        city: 'San Francisco',
      })
    ).toBe('United States, California, San Francisco');

    expect(formatDetailIsp(undefined)).toBe('');
    expect(formatDetailIsp({ scope: 'public', isp: 'NTT', asn: 4713 })).toBe('NTT (AS4713)');
    expect(formatDetailIsp({ scope: 'public', isp: 'NTT' })).toBe('NTT');
    expect(formatDetailIsp({ scope: 'public', asn: 4713 })).toBe('AS4713');
    expect(formatDetailIsp({ scope: 'public' })).toBe('');
    expect(
      formatDetailIsp({ scope: 'public', org: 'Open Computer Network', isp: 'NTT', asn: 4713 })
    ).toBe('Open Computer Network · NTT (AS4713)');
    expect(formatDetailIsp({ scope: 'public', org: 'Google', isp: 'google', asn: 15169 })).toBe(
      'Google (AS15169)'
    );
  });

  test('renders client cell with three lines: IP, location · ISP, and user agent', async () => {
    const { EventClientCell } = await import('@/features/usage/components/EventCells');

    const event = {
      clientIp: '153.156.0.1',
      userAgent: 'Claude-Code/1.0.0',
      clientGeo: {
        scope: 'public' as const,
        country: 'Japan',
        city: 'Tokyo',
        isp: 'Open Computer Network',
      },
    } as unknown as import('@/services/api/usageStore').UsageEvent;

    const markup = renderToStaticMarkup(createElement(EventClientCell, { event }));

    expect(markup).toContain('153.156.0.1');
    expect(markup).toContain('Japan, Tokyo · Open Computer Network');
    expect(markup).toContain('Claude-Code/1.0.0');
    expect(markup).toContain('title="153.156.0.1"');
    expect(markup).toContain('title="Japan, Tokyo · Open Computer Network"');
    expect(markup).toContain('title="Claude-Code/1.0.0"');
  });
});

describe('usage risk labels', () => {
  test('labels Gemini safety blocks with their reason and falls back for unknown risks', async () => {
    const i18n = (await import('@/i18n')).default;
    const { riskHint, riskLabel } = await import('@/features/usage/logic');
    const t = i18n.t.bind(i18n) as (key: string, options?: Record<string, unknown>) => string;
    expect(riskLabel(t, 'prompt_blocked_prohibited_content')).toBe(
      i18n.t('usage_stats.risk_type_prompt_blocked', { reason: 'PROHIBITED_CONTENT' })
    );
    expect(riskLabel(t, 'prompt_blocked_prohibited_content')).toContain('PROHIBITED_CONTENT');
    expect(riskHint(t, 'output_blocked_safety')).toContain('SAFETY');
    expect(riskLabel(t, 'refusal_cyber')).toBe(i18n.t('usage_stats.risk_type_refusal_cyber'));
    expect(riskLabel(t, 'model_reroute')).toBe(i18n.t('usage_stats.risk_type_model_reroute'));
    expect(riskHint(t, 'model_reroute')).toBe(i18n.t('usage_stats.risk_hint_model_reroute'));

    const enJSON = (await Bun.file('src/i18n/locales/en.json').json()) as {
      usage_stats: Record<string, string>;
    };
    const zhJSON = (await Bun.file('src/i18n/locales/zh-CN.json').json()) as {
      usage_stats: Record<string, string>;
    };
    expect(enJSON.usage_stats.risk_type_model_reroute).toBe('Model reroute');
    expect(zhJSON.usage_stats.risk_type_model_reroute).toBe('模型改道');

    expect(riskLabel(t, 'refusal_refusal')).toBe(i18n.t('usage_stats.risk_type_refusal_refusal'));
    expect(riskHint(t, 'refusal_refusal')).toBe(i18n.t('usage_stats.risk_hint_refusal_refusal'));
    expect(riskLabel(t, 'refusal_reasoning_extraction')).toBe(
      i18n.t('usage_stats.risk_type_refusal_reasoning_extraction')
    );
    expect(riskLabel(t, 'refusal_frontier_llm')).toBe(
      i18n.t('usage_stats.risk_type_refusal_frontier_llm')
    );
    expect(riskLabel(t, 'refusal_fallback')).toBe(i18n.t('usage_stats.risk_type_refusal_fallback'));
    expect(riskHint(t, 'refusal_fallback')).toBe(i18n.t('usage_stats.risk_hint_refusal_fallback'));
    expect(riskLabel(t, 'refusal_unknown')).toBe('refusal_unknown');
    expect(riskHint(t, 'refusal_unknown')).toBe(i18n.t('usage_stats.risk_hint'));
  });

  test('EventModelCell renders badges on a third line and plain events with two lines', async () => {
    const i18n = (await import('@/i18n')).default;
    const { riskLabel } = await import('@/features/usage/logic');
    const { EventModelCell } = await import('@/features/usage/components/EventCells');
    const t = i18n.t.bind(i18n) as (key: string, options?: Record<string, unknown>) => string;
    const substitutedTag = i18n.t('usage_stats.substituted_tag');
    const cyberTag = riskLabel(t, 'cyber_policy');

    const baseEvent: UsageEvent = {
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
      reasoningEffort: 'high',
      stream: false,
      failed: false,
      statusCode: 200,
      error: '',
      latencyMs: 100,
      ttftMs: 50,
      outputTps: 0,
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
      risk: '',
      riskReason: '',
      riskPrompt: '',
      transport: 'http',
    };

    // Plain event: renders exactly two lines, no badges.
    const plainMarkup = renderToStaticMarkup(createElement(EventModelCell, { event: baseEvent }));
    expect(plainMarkup).toContain('gpt-5');
    expect(plainMarkup).toContain('Codex');
    expect(plainMarkup).not.toContain(substitutedTag);
    expect(plainMarkup).not.toContain(cyberTag);
    // Root container has 2 lines (1 model line, 1 provider line).
    const plainSubLines = plainMarkup.match(/<span class="undefined undefined">/g);
    expect(plainSubLines?.length).toBe(1);

    // Substituted and risk event: line 1 has model arrow, line 3 has badges, line 1 has NO badges.
    const flaggedEvent: UsageEvent = {
      ...baseEvent,
      responseModel: 'gpt-4',
      substituted: true,
      risk: 'cyber_policy',
      riskReason: 'flagged',
    };
    const flaggedMarkup = renderToStaticMarkup(
      createElement(EventModelCell, { event: flaggedEvent })
    );
    expect(flaggedMarkup).toContain('gpt-5');
    expect(flaggedMarkup).toContain('gpt-4');
    expect(flaggedMarkup).toContain('→');
    expect(flaggedMarkup).toContain(substitutedTag);
    expect(flaggedMarkup).toContain(cyberTag);

    // Root container has 3 lines (1 model line, 1 provider line, 1 badge line).
    const flaggedSubLines = flaggedMarkup.match(/<span class="undefined undefined">/g);
    expect(flaggedSubLines?.length).toBe(2);

    // Line 1 contains model and responseModel, but does NOT contain badges.
    const firstLineMatch = flaggedMarkup.match(
      /<span class="undefined undefined undefined">(.*?)<\/span><span class="undefined undefined">/
    );
    expect(firstLineMatch).toBeTruthy();
    expect(firstLineMatch![1]).toContain('gpt-5');
    expect(firstLineMatch![1]).toContain('gpt-4');
    expect(firstLineMatch![1]).not.toContain(substitutedTag);
    expect(firstLineMatch![1]).not.toContain(cyberTag);
  });
});

describe('usage store database', () => {
  test('normalizes the storage status and validates keep days', async () => {
    const { normalizeUsageStorage } = await import('@/services/api/usageStore');
    const { parseKeepDays } = await import('@/features/usage/logic');

    const empty = normalizeUsageStorage(null);
    expect(empty).toMatchObject({ fileBytes: 0, events: 0, oldestEvent: 0, eventsPerDay: 0 });
    expect(empty.optimize).toMatchObject({ running: false, finishedAt: 0, error: '' });
    expect(
      normalizeUsageStorage({
        path: '/d/usage.db',
        file_bytes: 2048.9,
        free_bytes: -1,
        events_per_day: 12.5,
        retention_days: -1,
        optimize: { running: true, keep_days: 7, deleted_events: 3 },
      })
    ).toMatchObject({
      path: '/d/usage.db',
      fileBytes: 2048,
      freeBytes: 0,
      eventsPerDay: 12.5,
      retentionDays: -1,
      optimize: { running: true, keepDays: 7, deletedEvents: 3 },
    });

    expect(parseKeepDays('')).toBe(0);
    expect(parseKeepDays(' 7 ')).toBe(7);
    expect(parseKeepDays('3650')).toBe(3650);
    for (const bad of ['0', '-1', '1.5', '3651', 'x']) expect(parseKeepDays(bad)).toBeNull();
  });

  test('renders size, growth and the last optimize result', async () => {
    const { normalizeUsageStorage } = await import('@/services/api/usageStore');
    const { StorageCard } = await import('@/features/usage/components/StorageCard');
    const status = normalizeUsageStorage({
      path: '/d/usage.db',
      file_bytes: 3 * 1024 * 1024,
      wal_bytes: 1024 * 1024,
      free_bytes: 512 * 1024,
      events: 12000,
      oldest_event: Date.UTC(2026, 9, 1),
      events_per_day: 400,
      growth_bytes_per_day: 100 * 1024,
      retention_days: 30,
      optimize: { finished_at: Date.UTC(2026, 9, 20), before_bytes: 8 << 20, after_bytes: 4 << 20 },
    });
    const markup = renderToStaticMarkup(createElement(StorageCard, { initialStatus: status }));
    expect(markup).toContain('4.00 MB');
    expect(markup).toContain('512.00 KB');
    expect(markup).toContain('100.00 KB');
    expect(markup).toContain('/d/usage.db');
    expect(markup).toContain('placeholder="30"');
    expect(markup).toContain('8.00 MB');
    expect(markup).toContain('role="status"');

    const running = renderToStaticMarkup(
      createElement(StorageCard, {
        initialStatus: { ...status, optimize: { ...status.optimize, running: true } },
      })
    );
    expect(running).not.toContain('role="status"');
    expect(running).toMatch(/<button[^>]*disabled=""/);

    const disabledCard = renderToStaticMarkup(
      createElement(StorageCard, {
        initialStatus: status,
        disabled: true,
      })
    );
    expect(disabledCard).toMatch(/<input[^>]*disabled=""/);
    expect(disabledCard).toMatch(/<button[^>]*disabled=""/);
  });

  test('sets exclude-embeddings by its own path when saving', async () => {
    const { apiClient } = await import('@/services/api/client');
    const { usageStoreApi } = await import('@/services/api/usageStore');
    const origPut = apiClient.put.bind(apiClient);
    const origPatch = apiClient.patch.bind(apiClient);
    const calls: string[] = [];
    apiClient.put = (async (url: string, data?: unknown) => {
      calls.push(`PUT ${url} ${JSON.stringify(data)}`);
      return {} as never;
    }) as typeof apiClient.put;
    apiClient.patch = (async (url: string) => {
      calls.push(`PATCH ${url}`);
      return {} as never;
    }) as typeof apiClient.patch;
    const base = {
      enable: true,
      path: '',
      retentionDays: 0,
      disableGeoip: false,
      disableRiskPrompts: false,
      excludeEmbeddings: false,
    };
    try {
      await usageStoreApi.saveSettings({ ...base, excludeEmbeddings: true }, base);
      expect(calls).toEqual(['PUT /config/observability/usage/exclude-embeddings true']);
      // The store PATCH goes first, so a core that rejects the flag still saves it.
      calls.length = 0;
      await usageStoreApi.saveSettings(
        { ...base, retentionDays: 7, excludeEmbeddings: true },
        base
      );
      expect(calls).toEqual([
        'PATCH /config/observability/usage/store',
        'PUT /config/observability/usage/exclude-embeddings true',
      ]);
    } finally {
      apiClient.put = origPut;
      apiClient.patch = origPatch;
    }
  });
});
