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
  /** Token-weighted output tokens per second after the first token; 0 when not measured. */
  outputTps: number;
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
  /** True when computed from per-request events (exact edges, long-context prices). */
  exact: boolean;
  /** True when a result filter needed events but part of the range is past retention. */
  partial: boolean;
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
  /** Output tokens per second after the first token; 0 when not measured (non-streamed etc.). */
  outputTps: number;
  tokens: UsageTokens;
  cost: number;
  priced: boolean;
  clientIp: string;
  /** Recorded downstream transport ('' for rows stored before it was recorded). */
  transport: string;
  userAgent: string;
  responseModel: string;
  substituted: boolean;
}

export interface UsageEventsPage {
  events: UsageEvent[];
  nextBefore: number;
  lastId: number;
}

export interface UsageModelOption {
  model: string;
  provider: string;
  requests: number;
}

export interface UsageProviderOption {
  provider: string;
  requests: number;
}

export interface UsageApiKeyOption {
  apiKeyId: string;
  apiKey: string;
  requests: number;
}

export interface UsageCredentialOption {
  authIndex: string;
  provider: string;
  authType: string;
  source: string;
  requests: number;
}

export interface UsageOptions {
  models: UsageModelOption[];
  providers: UsageProviderOption[];
  apiKeys: UsageApiKeyOption[];
  credentials: UsageCredentialOption[];
}

export interface UsageDimensionFilter {
  model?: string[];
  provider?: string[];
  apiKeyId?: string[];
  authIndex?: string[];
}

/** Stats filters: the dimensions plus the request result (events-backed on the server). */
export interface UsageStatsFilter extends UsageDimensionFilter {
  failed?: boolean;
  substituted?: boolean;
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

export interface UsageEventsQuery extends UsageDimensionFilter {
  from?: number;
  to?: number;
  failed?: boolean;
  substituted?: boolean;
  before?: number;
  after?: number;
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
  /** Per-request output speed in tokens per second. */
  tps: UsagePercentiles;
  histogram: number[];
  histogramBoundsMs: number[];
  models: {
    model: string;
    latency: UsagePercentiles;
    ttft: UsagePercentiles;
    tps: UsagePercentiles;
  }[];
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
    outputTps: num(a.output_tps),
  };
};

export const normalizeUsageStats = (data: unknown): UsageStats => {
  const d = rec(data);
  return {
    from: num(d.from),
    to: num(d.to),
    bucket: d.bucket === 'day' ? 'day' : 'hour',
    exact: d.exact === true,
    partial: d.partial === true,
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
    lastId: num(d.last_id),
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
      outputTps: num(e.output_tps),
      tokens: normalizeTokens(e.tokens),
      cost: num(e.cost),
      priced: e.priced === true,
      clientIp: str(e.client_ip),
      transport: str(e.transport),
      userAgent: str(e.user_agent),
      responseModel: str(e.response_model),
      substituted: e.substituted === true,
    })),
  };
};

export const normalizeUsageOptions = (data: unknown): UsageOptions => {
  const d = rec(data);
  return {
    models: list(d.models).map((m) => ({
      model: str(m.model),
      provider: str(m.provider),
      requests: num(m.requests),
    })),
    providers: list(d.providers).map((p) => ({
      provider: str(p.provider),
      requests: num(p.requests),
    })),
    apiKeys: list(d.api_keys).map((k) => ({
      apiKeyId: str(k.api_key_id),
      apiKey: str(k.api_key),
      requests: num(k.requests),
    })),
    credentials: list(d.credentials).map((c) => ({
      authIndex: str(c.auth_index),
      provider: str(c.provider),
      authType: str(c.auth_type),
      source: str(c.source),
      requests: num(c.requests),
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
    tps: normalizePercentiles(d.tps),
    histogram: nums(d.histogram),
    histogramBoundsMs: nums(d.histogram_bounds_ms),
    models: list(d.models).map((m) => ({
      model: str(m.model),
      latency: normalizePercentiles(m.latency),
      ttft: normalizePercentiles(m.ttft),
      tps: normalizePercentiles(m.tps),
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

export const buildUsageParams = (params: Record<string, unknown>): URLSearchParams => {
  const search = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val === undefined || val === null || val === '') continue;
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item !== undefined && item !== null && item !== '') {
          search.append(key, String(item));
        }
      }
    } else {
      search.append(key, String(val));
    }
  }
  return search;
};

export interface UsageRealtimePoint {
  time: number;
  requests: number;
  failed: number;
  substituted: number;
  tokens: number;
  cost: number;
  avgLatencyMs: number;
}

/** A call still being served; upstream fields are empty until an attempt starts. */
export interface UsageInFlightRequest {
  id: number;
  /** Same as the request_id of the events this call records. */
  requestId: string;
  startedAt: number;
  elapsedMs: number;
  endpoint: string;
  transport: string;
  provider: string;
  model: string;
  authIndex: string;
  apiKeyId: string;
  apiKey: string;
}

export interface UsageRealtime {
  now: number;
  lastId: number;
  /** Model calls and WebSocket sessions running right now, across all filters. */
  inFlight: number;
  /** Up to 100 of them matching the filters, newest first. */
  inFlightRequests: UsageInFlightRequest[];
  current: {
    rpm1m: number;
    tpm1m: number;
    rpm5m: number;
    tpm5m: number;
    failed5m: number;
    avgLatency5m: number;
  };
  series: UsageRealtimePoint[];
}

export const normalizeUsageRealtime = (data: unknown): UsageRealtime => {
  const d = rec(data);
  const c = rec(d.current);
  return {
    now: num(d.now),
    lastId: num(d.last_id),
    inFlight: num(d.in_flight),
    inFlightRequests: list(d.in_flight_requests).map((r) => ({
      id: num(r.id),
      requestId: str(r.request_id),
      startedAt: num(r.started_at),
      elapsedMs: num(r.elapsed_ms),
      endpoint: str(r.endpoint),
      transport: str(r.transport),
      provider: str(r.provider),
      model: str(r.model),
      authIndex: str(r.auth_index),
      apiKeyId: str(r.api_key_id),
      apiKey: str(r.api_key),
    })),
    current: {
      rpm1m: num(c.rpm_1m),
      tpm1m: num(c.tpm_1m),
      rpm5m: num(c.rpm_5m),
      tpm5m: num(c.tpm_5m),
      failed5m: num(c.failed_5m),
      avgLatency5m: num(c.avg_latency_5m),
    },
    series: list(d.series).map((p) => ({
      time: num(p.time),
      requests: num(p.requests),
      failed: num(p.failed),
      substituted: num(p.substituted),
      tokens: num(p.tokens),
      cost: num(p.cost),
      avgLatencyMs: num(p.avg_latency_ms),
    })),
  };
};

const OVERRIDES_PATH = '/config/observability/usage/store/pricing/overrides';

/** True when the backend reports the store is turned off (409 usage_store_disabled). */
export const isUsageStoreDisabled = (error: unknown): boolean =>
  isRecord(error) && error.status === 409 && error.apiCode === USAGE_STORE_DISABLED;

export const usageStoreApi = {
  getStats: async (
    from: number,
    to: number,
    tzOffsetMinutes: number,
    filter: UsageStatsFilter = {}
  ) =>
    normalizeUsageStats(
      await apiClient.get('/observability/usage/stats', {
        params: buildUsageParams({
          from,
          to,
          tz_offset: tzOffsetMinutes,
          model: filter.model,
          provider: filter.provider,
          api_key_id: filter.apiKeyId,
          auth_index: filter.authIndex,
          failed: filter.failed,
          substituted: filter.substituted,
        }),
      })
    ),
  getRealtime: async (minutes: number, filter: UsageDimensionFilter = {}) =>
    normalizeUsageRealtime(
      await apiClient.get('/observability/usage/realtime', {
        params: buildUsageParams({
          minutes,
          model: filter.model,
          provider: filter.provider,
          api_key_id: filter.apiKeyId,
          auth_index: filter.authIndex,
        }),
      })
    ),
  getOptions: async (from: number, to: number) =>
    normalizeUsageOptions(
      await apiClient.get('/observability/usage/options', {
        params: buildUsageParams({ from, to }),
      })
    ),
  getEvents: async (query: UsageEventsQuery) =>
    normalizeUsageEvents(
      await apiClient.get('/observability/usage/events', {
        params: buildUsageParams({
          from: query.from,
          to: query.to,
          model: query.model,
          provider: query.provider,
          api_key_id: query.apiKeyId,
          auth_index: query.authIndex,
          failed: query.failed,
          substituted: query.substituted,
          before: query.before,
          after: query.after,
          limit: query.limit,
        }),
      })
    ),
  exportEvents: async (query: UsageEventsQuery, format: 'csv' | 'json'): Promise<Blob> => {
    const response = await apiClient.getRaw('/observability/usage/events/export', {
      params: buildUsageParams({
        from: query.from,
        to: query.to,
        model: query.model,
        provider: query.provider,
        api_key_id: query.apiKeyId,
        auth_index: query.authIndex,
        failed: query.failed,
        substituted: query.substituted,
        format,
      }),
      responseType: 'blob',
    });
    return response.data as Blob;
  },
  getAnalysis: async (
    from: number,
    to: number,
    tzOffsetMinutes: number,
    filter: UsageDimensionFilter = {}
  ) =>
    normalizeUsageAnalysis(
      await apiClient.get('/observability/usage/analysis', {
        params: buildUsageParams({
          from,
          to,
          tz_offset: tzOffsetMinutes,
          model: filter.model,
          provider: filter.provider,
          api_key_id: filter.apiKeyId,
          auth_index: filter.authIndex,
        }),
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
