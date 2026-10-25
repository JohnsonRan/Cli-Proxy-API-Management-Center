import { describe, expect, test } from 'bun:test';
import { normalizeUsageQuotaValue } from '@/services/api/usageStore';
import {
  MIN_RELIABLE_PERCENT,
  buildQuotaValues,
  formatPeriod,
  isReliableWindow,
  quotaPeriods,
  windowIssue,
} from '@/features/usage/quotaValue';

const raw = (
  authIndex: string,
  window: string,
  period: number,
  resetAt: number,
  used: number,
  cost: number,
  fullCost: number | null,
  unpricedRequests = 0
) => ({
  auth_index: authIndex,
  provider: 'codex',
  window,
  period_seconds: period,
  start_at: resetAt - period,
  reset_at: resetAt,
  used_percent: used,
  observed_at: resetAt * 1000 - 1,
  samples: 2,
  usage: { requests: 3, cost, tokens: { total: 1000 }, unpriced_requests: unpricedRequests },
  full_cost: fullCost,
  full_tokens: fullCost === null ? null : 1000 * (100 / used),
  partial: false,
});

describe('usage quota value', () => {
  test('normalizes the backend payload and drops malformed rows', () => {
    const res = normalizeUsageQuotaValue({
      windows: [raw('a1', 'primary', 18000, 100_000, 20, 4, 20), 'junk'],
      models: [
        {
          auth_index: 'a1',
          provider: 'codex',
          period_seconds: 18000,
          status: 'fitted',
          windows: 4,
          segments: 10,
          external_segments: 1,
          cost_used: 15.5,
          pct_per_usd: 2.5,
          full_cost: 40.0,
          full_cost_low: 36.0,
          full_cost_high: 45.0,
          ci_percent: 12.5,
          features: [
            { model: 'gpt-5', kind: 'output', multiplier: 1.2, share: 60 },
            { model: 'gpt-5', kind: 'input', multiplier: 0.9, share: 40 },
          ],
          model_values: [{ model: 'gpt-5', full_cost: 41.5 }],
        },
      ],
    });
    expect(res.windows).toHaveLength(1);
    expect(res.windows[0]).toMatchObject({
      authIndex: 'a1',
      periodSeconds: 18000,
      startAt: 82_000,
      usedPercent: 20,
      fullCost: 20,
      fullTokens: 5000,
    });
    expect(res.windows[0].usage.cost).toBe(4);
    expect(res.models).toHaveLength(1);
    expect(res.models[0]).toMatchObject({
      authIndex: 'a1',
      periodSeconds: 18000,
      status: 'fitted',
      windows: 4,
      segments: 10,
      fullCost: 40.0,
      ciPercent: 12.5,
    });
    expect(res.models[0].features).toHaveLength(2);
    expect(res.models[0].modelValues).toHaveLength(1);

    expect(normalizeUsageQuotaValue(null)).toEqual({ windows: [], models: [] });
    expect(
      normalizeUsageQuotaValue({ windows: [raw('a', 'w', 1, 1, 0, 0, null)] }).windows[0].fullCost
    ).toBe(null);
  });

  test('pairs windows by period, quotes the newest reliable one and computes the ratio', () => {
    const res = normalizeUsageQuotaValue({
      windows: [
        // Codex plan with a single weekly window reported as "primary": must land in the 7d slot.
        raw('weekly-only', 'primary', 604800, 900_000, 30, 60, 200),
        raw('a1', 'primary', 18000, 100_000, 50, 10, 20),
        raw('a1', 'primary', 18000, 120_000, MIN_RELIABLE_PERCENT - 1, 1, 25),
        raw('a1', 'secondary', 604800, 700_000, 10, 30, 300),
      ],
    });
    const values = buildQuotaValues(res.windows);
    expect(values.map((c) => c.authIndex)).toEqual(['a1', 'weekly-only']);

    const [a1, weekly] = values;
    expect(a1.periods.map((p) => p.periodSeconds)).toEqual([18000, 604800]);
    const fiveHour = a1.periods[0];
    expect(fiveHour.current.resetAt).toBe(120_000);
    expect(isReliableWindow(fiveHour.current)).toBe(false);
    expect(fiveHour.estimate?.resetAt).toBe(100_000);
    expect(fiveHour.reference?.fullCost).toBe(20);
    expect(fiveHour.reference?.source).toBe('window');
    expect(fiveHour.history.map((w) => w.resetAt)).toEqual([100_000, 120_000]);
    expect(a1.ratio).toBe(15);

    expect(weekly.periods.map((p) => p.periodSeconds)).toEqual([604800]);
    expect(weekly.ratio).toBe(null);
    expect(quotaPeriods(values)).toEqual([18000, 604800]);
  });

  test('formats periods', () => {
    expect(formatPeriod(18000)).toBe('5h');
    expect(formatPeriod(604800)).toBe('7d');
    expect(formatPeriod(5400)).toBe('90m');
  });

  test('identifies window issues and ignores unpriced windows for estimates and ratio', () => {
    const low = normalizeUsageQuotaValue({
      windows: [raw('a1', 'primary', 18000, 100_000, MIN_RELIABLE_PERCENT - 1, 1, 20)],
    }).windows[0];
    const unpriced = normalizeUsageQuotaValue({
      windows: [raw('a1', 'primary', 18000, 100_000, 50, 0, 0, 1)],
    }).windows[0];
    const reliable = normalizeUsageQuotaValue({
      windows: [raw('a1', 'primary', 18000, 100_000, 50, 10, 20, 0)],
    }).windows[0];

    expect(windowIssue(low)).toBe('low');
    expect(isReliableWindow(low)).toBe(false);

    expect(windowIssue(unpriced)).toBe('unpriced');
    expect(isReliableWindow(unpriced)).toBe(false);

    expect(windowIssue(reliable)).toBe(null);
    expect(isReliableWindow(reliable)).toBe(true);

    // External usage deducted: reliable when ownPercent >= 5
    const externalReliable = normalizeUsageQuotaValue({
      windows: [
        {
          ...raw('a1', 'primary', 18000, 100_000, 70, 10, 25, 0),
          external_percent: 30,
          external_checked: true,
          own_percent: 40,
        },
      ],
    }).windows[0];
    expect(externalReliable.externalPercent).toBe(30);
    expect(externalReliable.ownPercent).toBe(40);
    expect(windowIssue(externalReliable)).toBe(null);
    expect(isReliableWindow(externalReliable)).toBe(true);

    // External usage leaves ownPercent < 5: issue is 'low'
    const externalLow = normalizeUsageQuotaValue({
      windows: [
        {
          ...raw('a1', 'primary', 18000, 100_000, 10, 10, 25, 0),
          external_percent: 8,
          external_checked: true,
          own_percent: 2,
        },
      ],
    }).windows[0];
    expect(windowIssue(externalLow)).toBe('low');
    expect(isReliableWindow(externalLow)).toBe(false);

    // When all windows for a 7d period are unpriced, it must not become the estimate or produce a ratio
    const res = normalizeUsageQuotaValue({
      windows: [
        raw('a1', 'primary', 18000, 100_000, 50, 10, 20), // reliable 5h
        raw('a1', 'secondary', 604800, 700_000, 50, 0, 0, 2), // unpriced 7d
      ],
    });
    const values = buildQuotaValues(res.windows);
    expect(values).toHaveLength(1);
    const [c] = values;
    expect(c.periods[0].estimate).not.toBeNull();
    expect(c.periods[1].estimate).toBeNull();
    expect(c.ratio).toBeNull();
  });

  test('prefers fitted model for reference estimate and computes ratio from model values', () => {
    const res = normalizeUsageQuotaValue({
      windows: [
        raw('a1', 'primary', 18000, 100_000, 50, 10, 20),
        raw('a1', 'secondary', 604800, 700_000, 20, 40, 200),
      ],
      models: [
        {
          auth_index: 'a1',
          provider: 'codex',
          period_seconds: 18000,
          status: 'fitted',
          windows: 3,
          segments: 8,
          external_segments: 0,
          cost_used: 30,
          pct_per_usd: 5.0,
          full_cost: 22.5,
          full_cost_low: 20.0,
          full_cost_high: 25.0,
          ci_percent: 11.1,
          features: [],
          model_values: [],
        },
        {
          auth_index: 'a1',
          provider: 'codex',
          period_seconds: 604800,
          status: 'fitted',
          windows: 2,
          segments: 6,
          external_segments: 0,
          cost_used: 80,
          pct_per_usd: 0.45,
          full_cost: 225.0,
          full_cost_low: 210.0,
          full_cost_high: 240.0,
          ci_percent: 6.7,
          features: [],
          model_values: [],
        },
      ],
    });
    const values = buildQuotaValues(res.windows, res.models);
    expect(values).toHaveLength(1);
    const [c] = values;
    expect(c.periods[0].reference).toMatchObject({
      source: 'model',
      fullCost: 22.5,
      ciPercent: 11.1,
    });
    expect(c.periods[1].reference).toMatchObject({
      source: 'model',
      fullCost: 225.0,
      ciPercent: 6.7,
    });
    expect(c.ratio).toBe(10); // 225.0 / 22.5 = 10

    // When model status is insufficient, falls back to latest reliable window estimate
    const resFallback = normalizeUsageQuotaValue({
      windows: [raw('a2', 'primary', 18000, 100_000, 50, 10, 20)],
      models: [
        {
          auth_index: 'a2',
          provider: 'codex',
          period_seconds: 18000,
          status: 'insufficient',
          windows: 1,
          segments: 2,
          external_segments: 0,
          cost_used: 10,
          pct_per_usd: null,
          full_cost: null,
          full_cost_low: null,
          full_cost_high: null,
          ci_percent: null,
          features: [],
          model_values: [],
        },
      ],
    });
    const valuesFallback = buildQuotaValues(resFallback.windows, resFallback.models);
    expect(valuesFallback[0].periods[0].reference).toMatchObject({
      source: 'window',
      fullCost: 20,
    });
  });
});
