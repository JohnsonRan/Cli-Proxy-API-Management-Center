/**
 * Built-in usage store API (core patch/usage-store): /observability/usage/{stats,events,pricing}.
 */

import { apiClient } from './client';
import { getConfigValue } from './configValue';
import { isRecord } from '@/utils/helpers';

export const USAGE_STORE_DISABLED = 'usage_store_disabled';

export interface UsageTokens {
  inputUncached: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  unclassified: number;
  total: number;
}

export interface UsageAggregate {
  requests: number;
  failed: number;
  substituted: number;
  tokens: UsageTokens;
  cost: number;
  unpricedRequests: number;
  avgLatencyMs: number;
  avgTtftMs: number;
}

export interface UsageSeriesPoint extends UsageAggregate {
  time: number;
}

export interface UsageModelStat extends UsageAggregate {
  model: string;
  provider: string;
  priceSource: string;
}

export interface UsageApiKeyStat extends UsageAggregate {
  apiKeyId: string;
  apiKey: string;
}

export interface UsageCredentialStat extends UsageAggregate {
  authIndex: string;
  provider: string;
  authType: string;
  source: string;
}

export interface UsageStats {
  from: number;
  to: number;
  bucket: 'hour' | 'day';
  totals: UsageAggregate;
  series: UsageSeriesPoint[];
  models: UsageModelStat[];
  apiKeys: UsageApiKeyStat[];
  credentials: UsageCredentialStat[];
}

export interface UsageEvent {
  id: number;
  timestamp: number;
  requestId: string;
  provider: string;
  model: string;
  alias: string;
  endpoint: string;
  authIndex: string;
  source: string;
  apiKeyId: string;
  apiKey: string;
  serviceTier: string;
  reasoningEffort: string;
  stream: boolean;
  failed: boolean;
  statusCode: number;
  error: string;
  latencyMs: number;
  ttftMs: number;
  tokens: UsageTokens;
  cost: number;
  priced: boolean;
  clientIp: string;
  userAgent: string;
  responseModel: string;
  substituted: boolean;
}

export interface UsageEventsPage {
  events: UsageEvent[];
  nextBefore: number;
}

export interface UsagePrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface UsageModelPrice {
  model: string;
  source: string;
  price: UsagePrice | null;
}

export interface UsagePricing {
  modelsDev: { enabled: boolean; count: number; updatedAt: string; lastError: string };
  models: UsageModelPrice[];
}

export interface UsageEventsQuery {
  from?: number;
  to?: number;
  model?: string;
  provider?: string;
  apiKeyId?: string;
  authIndex?: string;
  failed?: boolean;
  substituted?: boolean;
  before?: number;
  limit?: number;
}

export interface UsagePercentiles {
  count: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
}

export interface UsageHeatCell {
  weekday: number;
  hour: number;
  requests: number;
  tokens: number;
  failed: number;
  cost: number;
}

export interface UsageAnalysis {
  sampled: boolean;
  latency: UsagePercentiles;
  ttft: UsagePercentiles;
  histogram: number[];
  histogramBoundsMs: number[];
  models: { model: string; latency: UsagePercentiles; ttft: UsagePercentiles }[];
  heatmap: UsageHeatCell[];
}

/** One configured price override (USD per million tokens); cache prices default to input when unset. */
export interface UsagePriceOverride {
  model: string;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const rec = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const normalizeTokens = (value: unknown): UsageTokens => {
  const t = rec(value);
  return {
    inputUncached: num(t.input_uncached),
    cacheRead: num(t.cache_read),
    cacheWrite: num(t.cache_write),
    output: num(t.output),
    reasoning: num(t.reasoning),
    unclassified: num(t.unclassified),
    total: num(t.total),
  };
};

const normalizeAggregate = (value: unknown): UsageAggregate => {
  const a = rec(value);
  return {
    requests: num(a.requests),
    failed: num(a.failed),
    substituted: num(a.substituted),
    tokens: normalizeTokens(a.tokens),
    cost: num(a.cost),
    unpricedRequests: num(a.unpriced_requests),
    avgLatencyMs: num(a.avg_latency_ms),
    avgTtftMs: num(a.avg_ttft_ms),
  };
};

export const normalizeUsageStats = (data: unknown): UsageStats => {
  const d = rec(data);
  return {
    from: num(d.from),
    to: num(d.to),
    bucket: d.bucket === 'day' ? 'day' : 'hour',
    totals: normalizeAggregate(d.totals),
    series: list(d.series).map((p) => ({ ...normalizeAggregate(p), time: num(p.time) })),
    models: list(d.models).map((m) => ({
      ...normalizeAggregate(m),
      model: str(m.model),
      provider: str(m.provider),
      priceSource: str(m.price_source),
    })),
    apiKeys: list(d.api_keys).map((k) => ({
      ...normalizeAggregate(k),
      apiKeyId: str(k.api_key_id),
      apiKey: str(k.api_key),
    })),
    credentials: list(d.credentials).map((c) => ({
      ...normalizeAggregate(c),
      authIndex: str(c.auth_index),
      provider: str(c.provider),
      authType: str(c.auth_type),
      source: str(c.source),
    })),
  };
};

export const normalizeUsageEvents = (data: unknown): UsageEventsPage => {
  const d = rec(data);
  return {
    nextBefore: num(d.next_before),
    events: list(d.events).map((e) => ({
      id: num(e.id),
      timestamp: num(e.timestamp),
      requestId: str(e.request_id),
      provider: str(e.provider),
      model: str(e.model),
      alias: str(e.alias),
      endpoint: str(e.endpoint),
      authIndex: str(e.auth_index),
      source: str(e.source),
      apiKeyId: str(e.api_key_id),
      apiKey: str(e.api_key),
      serviceTier: str(e.service_tier),
      reasoningEffort: str(e.reasoning_effort),
      stream: e.stream === true,
      failed: e.failed === true,
      statusCode: num(e.status_code),
      error: str(e.error),
      latencyMs: num(e.latency_ms),
      ttftMs: num(e.ttft_ms),
      tokens: normalizeTokens(e.tokens),
      cost: num(e.cost),
      priced: e.priced === true,
      clientIp: str(e.client_ip),
      userAgent: str(e.user_agent),
      responseModel: str(e.response_model),
      substituted: e.substituted === true,
    })),
  };
};

export const normalizeUsagePricing = (data: unknown): UsagePricing => {
  const d = rec(data);
  const md = rec(d.models_dev);
  return {
    modelsDev: {
      enabled: md.enabled === true,
      count: num(md.count),
      updatedAt: str(md.updated_at),
      lastError: str(md.last_error),
    },
    models: list(d.models).map((m) => {
      const p = isRecord(m.price) ? m.price : null;
      return {
        model: str(m.model),
        source: str(m.source),
        price: p
          ? {
              input: num(p.input),
              output: num(p.output),
              cacheRead: num(p.cache_read),
              cacheWrite: num(p.cache_write),
            }
          : null,
      };
    }),
  };
};

const normalizePercentiles = (value: unknown): UsagePercentiles => {
  const p = rec(value);
  return {
    count: num(p.count),
    p50: num(p.p50),
    p90: num(p.p90),
    p95: num(p.p95),
    p99: num(p.p99),
    max: num(p.max),
  };
};

export const normalizeUsageAnalysis = (data: unknown): UsageAnalysis => {
  const d = rec(data);
  const nums = (value: unknown) => (Array.isArray(value) ? value.map(num) : []);
  return {
    sampled: d.sampled === true,
    latency: normalizePercentiles(d.latency),
    ttft: normalizePercentiles(d.ttft),
    histogram: nums(d.histogram),
    histogramBoundsMs: nums(d.histogram_bounds_ms),
    models: list(d.models).map((m) => ({
      model: str(m.model),
      latency: normalizePercentiles(m.latency),
      ttft: normalizePercentiles(m.ttft),
    })),
    heatmap: list(d.heatmap).map((c) => ({
      weekday: num(c.weekday),
      hour: num(c.hour),
      requests: num(c.requests),
      tokens: num(c.tokens),
      failed: num(c.failed),
      cost: num(c.cost),
    })),
  };
};

const optionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export const normalizePriceOverrides = (data: unknown): UsagePriceOverride[] =>
  list(data)
    .filter((o) => str(o.model).trim())
    .map((o) => ({
      model: str(o.model).trim(),
      input: num(o.input),
      output: num(o.output),
      cacheRead: optionalNumber(o['cache-read']),
      cacheWrite: optionalNumber(o['cache-write']),
    }));

/** Serializes overrides to the config layout, omitting unset cache prices so they keep defaulting. */
export const serializePriceOverrides = (overrides: UsagePriceOverride[]) =>
  overrides
    .filter((o) => o.model.trim())
    .map((o) => ({
      model: o.model.trim(),
      input: o.input,
      output: o.output,
      ...(o.cacheRead === undefined ? {} : { 'cache-read': o.cacheRead }),
      ...(o.cacheWrite === undefined ? {} : { 'cache-write': o.cacheWrite }),
    }));

const eventParams = (query: UsageEventsQuery) => ({
  from: query.from,
  to: query.to,
  model: query.model || undefined,
  provider: query.provider || undefined,
  api_key_id: query.apiKeyId || undefined,
  auth_index: query.authIndex || undefined,
  failed: query.failed,
  substituted: query.substituted,
  before: query.before || undefined,
  limit: query.limit,
});

const OVERRIDES_PATH = '/config/observability/usage/store/pricing/overrides';

/** True when the backend reports the store is turned off (409 usage_store_disabled). */
export const isUsageStoreDisabled = (error: unknown): boolean =>
  isRecord(error) && error.status === 409 && error.apiCode === USAGE_STORE_DISABLED;

export const usageStoreApi = {
  getStats: async (
    from: number,
    to: number,
    tzOffsetMinutes: number,
    filter: Pick<UsageEventsQuery, 'model' | 'provider' | 'apiKeyId' | 'authIndex'> = {}
  ) =>
    normalizeUsageStats(
      await apiClient.get('/observability/usage/stats', {
        params: {
          from,
          to,
          tz_offset: tzOffsetMinutes,
          model: filter.model || undefined,
          provider: filter.provider || undefined,
          api_key_id: filter.apiKeyId || undefined,
          auth_index: filter.authIndex || undefined,
        },
      })
    ),
  getEvents: async (query: UsageEventsQuery) =>
    normalizeUsageEvents(
      await apiClient.get('/observability/usage/events', { params: eventParams(query) })
    ),
  exportEvents: async (query: UsageEventsQuery, format: 'csv' | 'json'): Promise<Blob> => {
    const response = await apiClient.getRaw('/observability/usage/events/export', {
      params: { ...eventParams(query), limit: undefined, before: undefined, format },
      responseType: 'blob',
    });
    return response.data as Blob;
  },
  getAnalysis: async (from: number, to: number, tzOffsetMinutes: number) =>
    normalizeUsageAnalysis(
      await apiClient.get('/observability/usage/analysis', {
        params: { from, to, tz_offset: tzOffsetMinutes },
      })
    ),
  getOverrides: async () =>
    normalizePriceOverrides(await getConfigValue<unknown>(OVERRIDES_PATH, [])),
  saveOverrides: (overrides: UsagePriceOverride[]) =>
    apiClient.put(OVERRIDES_PATH, serializePriceOverrides(overrides)),
  getPricing: async () =>
    normalizeUsagePricing(await apiClient.get('/observability/usage/pricing')),
  refreshPricing: async () =>
    normalizeUsagePricing(await apiClient.post('/observability/usage/pricing/refresh')),
  enable: () => apiClient.put('/config/observability/usage/store/enable', true),
};
