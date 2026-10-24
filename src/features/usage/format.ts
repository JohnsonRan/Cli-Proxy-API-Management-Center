import type { UsageAggregate } from '@/services/api/usageStore';

export const USAGE_RANGES = ['24h', '7d', '30d', '90d', 'today', 'yesterday', 'custom'] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

export const USAGE_TABS = ['overview', 'realtime', 'analysis', 'events', 'pricing'] as const;
export type UsageTab = (typeof USAGE_TABS)[number];
export const isUsageRange = (value: string | null): value is UsageRange =>
  typeof value === 'string' && (USAGE_RANGES as readonly string[]).includes(value);

export const isUsageTab = (value: string | null): value is UsageTab =>
  USAGE_TABS.includes(value as UsageTab);

export const USAGE_METRICS = ['requests', 'tokens', 'cost'] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

const RANGE_SECONDS: Record<Extract<UsageRange, '24h' | '7d' | '30d' | '90d'>, number> = {
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

export const formatDatetimeLocal = (sec: number): string => {
  const d = new Date(sec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const parseDatetimeLocal = (value: string): number | null => {
  if (!value || typeof value !== 'string') return null;
  const d = new Date(value);
  const ms = d.getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

export interface CustomRangeValidation {
  valid: boolean;
  error?: 'empty' | 'order' | 'future';
}

export const validateCustomRange = (
  fromSec?: number | null,
  toSec?: number | null,
  nowSec = Math.floor(Date.now() / 1000)
): CustomRangeValidation => {
  if (
    fromSec === undefined ||
    fromSec === null ||
    !Number.isFinite(fromSec) ||
    toSec === undefined ||
    toSec === null ||
    !Number.isFinite(toSec)
  ) {
    return { valid: false, error: 'empty' };
  }
  if (fromSec >= toSec) {
    return { valid: false, error: 'order' };
  }
  // Allow 60 seconds tolerance for clock drift between local machine and server.
  if (toSec > nowSec + 60) {
    return { valid: false, error: 'future' };
  }
  return { valid: true };
};

/** Unix-second window; tz offset is minutes east of UTC as the backend expects. */
export const rangeWindow = (
  range: UsageRange,
  nowMs = Date.now(),
  customFromSec?: number,
  customToSec?: number
) => {
  const nowSec = Math.floor(nowMs / 1000);
  const tzOffset = -new Date(nowMs).getTimezoneOffset();

  if (range === 'custom') {
    const from =
      typeof customFromSec === 'number' && Number.isFinite(customFromSec)
        ? customFromSec
        : nowSec - 24 * 3600;
    const to =
      typeof customToSec === 'number' && Number.isFinite(customToSec) ? customToSec : nowSec;
    return { from, to, tzOffset };
  }

  if (range === 'today') {
    const start = new Date(nowMs);
    start.setHours(0, 0, 0, 0);
    const from = Math.floor(start.getTime() / 1000);
    const to = Math.max(nowSec, from + 1);
    return { from, to, tzOffset };
  }

  if (range === 'yesterday') {
    const start = new Date(nowMs);
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const from = Math.floor(start.getTime() / 1000);
    const to = from + 86400;
    return { from, to, tzOffset };
  }

  return {
    from: nowSec - RANGE_SECONDS[range],
    to: nowSec,
    tzOffset,
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
  for (let i = 0; i < units.length; i++) {
    const [size, unit] = units[i];
    if (abs >= size) {
      const scaled = value / size;
      const rounded = Math.abs(scaled) >= 100 ? Math.round(scaled) : Number(scaled.toFixed(1));
      if (Math.abs(rounded) >= 1000 && i > 0) {
        const nextUnit = units[i - 1][1];
        return `${Number((rounded / 1000).toFixed(1))}${nextUnit}`;
      }
      return `${rounded}${unit}`;
    }
  }
  const rounded = Math.round(value);
  if (Math.abs(rounded) >= 1000) return value < 0 ? '-1K' : '1K';
  return String(rounded);
};

/** Hover text for a compact count: the full grouped number, or undefined when nothing is hidden. */
export const exactCount = (value: number): string | undefined =>
  Math.abs(value) >= 1000 ? Math.round(value).toLocaleString('en-US') : undefined;

/** Hover text for a rounded cost: dollars to four decimals. */
export const exactCost = (usd: number): string =>
  `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

export const formatMs = (ms: number): string => {
  if (ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
};

/** Output speed: "42.5 t/s" below 100, "180 t/s" above; '—' when not measured. */
export const formatTps = (tps: number): string => {
  if (!(tps > 0)) return '—';
  return `${tps < 100 ? tps.toFixed(1) : Math.round(tps).toLocaleString('en-US')} t/s`;
};

/** Success rate in percent, or null when there were no requests. */
export const successRate = (a: Pick<UsageAggregate, 'requests' | 'failed'>): number | null =>
  a.requests > 0 ? ((a.requests - a.failed) / a.requests) * 100 : null;

/** Average tokens per request, 0 without requests. */
export const tokensPerRequest = (a: UsageAggregate): number =>
  a.requests > 0 ? a.tokens.total / a.requests : 0;

/** Average cost per priced request, or null when none of them had a price. */
export const costPerRequest = (a: UsageAggregate): number | null => {
  const priced = a.requests - a.unpricedRequests;
  return priced > 0 ? a.cost / priced : null;
};

/**
 * Blended cost per million tokens: the model's effective unit price, independent of request size.
 * Only defined for fully priced aggregates, since the tokens of unpriced requests are not tracked apart.
 */
export const costPerMillionTokens = (a: UsageAggregate): number | null =>
  a.requests > 0 && a.unpricedRequests <= 0 && a.tokens.total > 0
    ? (a.cost / a.tokens.total) * 1e6
    : null;

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
