import { describe, expect, test } from 'bun:test';
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
  barFractions,
  formatCompact,
  formatCost,
  formatMs,
  rangeWindow,
  successRate,
} from '@/features/usage/format';
import { UsageChart } from '@/features/usage/UsageChart';

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

  test('computes rates, windows and bar heights', () => {
    expect(successRate({ requests: 0, failed: 0 })).toBeNull();
    expect(successRate({ requests: 4, failed: 1 })).toBe(75);
    const window = rangeWindow('7d', 1_700_000_000_000);
    expect(window.to - window.from).toBe(7 * 86400);
    expect(window.tzOffset).toBe(-new Date(1_700_000_000_000).getTimezoneOffset());

    const series = normalizeUsageStats({
      series: [
        { time: 0, ...aggregate(2, 0, 1) },
        { time: 3600, ...aggregate(4, 2, 0) },
      ],
    }).series;
    expect(barFractions(series, 'requests')).toEqual([0.5, 1]);
    expect(barFractions(series, 'cost')).toEqual([1, 0]);
    expect(barFractions([], 'tokens')).toEqual([]);
  });

  test('chart renders one bar per bucket with an accessible label', () => {
    const series = normalizeUsageStats({
      series: [
        { time: 0, ...aggregate(2, 0, 1) },
        { time: 3600, ...aggregate(4, 2, 0) },
      ],
    }).series;
    const markup = renderToStaticMarkup(
      createElement(UsageChart, { series, bucket: 'hour', metric: 'requests' })
    );
    expect(markup).toContain('role="img"');
    expect(markup.match(/<title>/g)).toHaveLength(2);
    expect(markup).toContain('aria-label=');
  });
});
