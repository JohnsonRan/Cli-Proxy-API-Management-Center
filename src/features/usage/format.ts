import type { UsageAggregate } from '@/services/api/usageStore';

export const USAGE_RANGES = ['24h', '7d', '30d', '90d'] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

export const USAGE_TABS = ['overview', 'analysis', 'events', 'pricing'] as const;
export type UsageTab = (typeof USAGE_TABS)[number];
export const isUsageTab = (value: string | null): value is UsageTab =>
  USAGE_TABS.includes(value as UsageTab);

export const USAGE_METRICS = ['requests', 'tokens', 'cost'] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

const RANGE_SECONDS: Record<UsageRange, number> = {
  '24h': 24 * 3600,
  '7d': 7 * 86400,
  '30d': 30 * 86400,
  '90d': 90 * 86400,
};

/** The window of the same length right before `window`, for period-over-period comparison. */
export const previousWindow = (window: { from: number; to: number }) => ({
  from: window.from - (window.to - window.from),
  to: window.from,
});

/** Relative change in percent, or null when there is no previous value to compare with. */
export const changePercent = (current: number, previous: number): number | null =>
  previous > 0 ? ((current - previous) / previous) * 100 : null;

/** Share of input tokens served from cache, in percent, or null without input. */
export const cacheHitRate = (a: UsageAggregate): number | null => {
  const input = inputTokens(a);
  return input > 0 ? (a.tokens.cacheRead / input) * 100 : null;
};

export const formatPercent = (value: number | null, digits = 1): string =>
  value === null ? '—' : `${value.toFixed(digits)}%`;

/** Unix-second window ending now; tz offset is minutes east of UTC as the backend expects. */
export const rangeWindow = (range: UsageRange, nowMs = Date.now()) => {
  const to = Math.floor(nowMs / 1000);
  return {
    from: to - RANGE_SECONDS[range],
    to,
    tzOffset: -new Date(nowMs).getTimezoneOffset(),
  };
};

export const formatCost = (usd: number): string => {
  if (usd === 0) return '$0';
  if (usd < 0.0001) return '<$0.0001';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd).toLocaleString('en-US')}`;
};

/** Compact token/request counts: 950, 1.2K, 3.4M, 1.1B. */
export const formatCompact = (value: number): string => {
  const abs = Math.abs(value);
  const units: [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, unit] of units) {
    if (abs >= size) {
      const scaled = value / size;
      return `${scaled >= 100 ? Math.round(scaled) : Number(scaled.toFixed(1))}${unit}`;
    }
  }
  return String(Math.round(value));
};

export const formatMs = (ms: number): string => {
  if (ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
};

/** Success rate in percent, or null when there were no requests. */
export const successRate = (a: Pick<UsageAggregate, 'requests' | 'failed'>): number | null =>
  a.requests > 0 ? ((a.requests - a.failed) / a.requests) * 100 : null;

/** Input tokens including cache reads and writes. */
export const inputTokens = (a: UsageAggregate): number =>
  a.tokens.inputUncached + a.tokens.cacheRead + a.tokens.cacheWrite;

export const formatBucketLabel = (
  timeSec: number,
  bucket: 'hour' | 'day',
  locale?: string
): string =>
  new Date(timeSec * 1000).toLocaleString(
    locale,
    bucket === 'hour'
      ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { year: 'numeric', month: 'numeric', day: 'numeric' }
  );
