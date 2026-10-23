/**
 * Built-in usage store API (core patch/usage-store): /observability/usage/{stats,events,pricing}.
 */

import { apiClient } from './client';
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
  failed?: boolean;
  before?: number;
  limit?: number;
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

/** True when the backend reports the store is turned off (409 usage_store_disabled). */
export const isUsageStoreDisabled = (error: unknown): boolean =>
  isRecord(error) && error.status === 409 && error.apiCode === USAGE_STORE_DISABLED;

export const usageStoreApi = {
  getStats: async (from: number, to: number, tzOffsetMinutes: number) =>
    normalizeUsageStats(
      await apiClient.get('/observability/usage/stats', {
        params: { from, to, tz_offset: tzOffsetMinutes },
      })
    ),
  getEvents: async (query: UsageEventsQuery) =>
    normalizeUsageEvents(await apiClient.get('/observability/usage/events', { params: query })),
  getPricing: async () =>
    normalizeUsagePricing(await apiClient.get('/observability/usage/pricing')),
  refreshPricing: async () =>
    normalizeUsagePricing(await apiClient.post('/observability/usage/pricing/refresh')),
  enable: () => apiClient.put('/config/observability/usage/store/enable', true),
};
