/**
 * Built-in usage store API (core patch/usage-store): /observability/usage/{stats,events,pricing}.
 */

import { apiClient } from './client';
import { getConfigValue, guardConfigConnection, isMissingConfigValue } from './configValue';
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

export interface ClientGeo {
  scope: 'public' | 'private' | 'loopback';
  countryCode?: string;
  country?: string;
  region?: string;
  city?: string;
  asn?: number;
  isp?: string;
  /** Organization using the address (more specific than the ISP when known). */
  org?: string;
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
  clientGeo?: ClientGeo;
  /** Recorded downstream transport ('' for rows stored before it was recorded). */
  transport: string;
  userAgent: string;
  responseModel: string;
  substituted: boolean;
  /** Upstream safety action (cyber_policy, model_reroute, ...); "" when none. */
  risk: string;
  /** Reason the upstream gave (rejection message, Claude refusal explanation); "" when none. */
  riskReason: string;
  /** Flagged turn as plain text, kept only for risk events. */
  riskPrompt: string;
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
  risk?: boolean;
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
  risk?: boolean;
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

export const normalizeClientGeo = (raw: unknown): ClientGeo | undefined => {
  if (!isRecord(raw)) return undefined;
  const rawScope = str(raw.scope).toLowerCase();
  const scope: 'public' | 'private' | 'loopback' =
    rawScope === 'private' || rawScope === 'loopback' ? rawScope : 'public';
  const countryCode = str(raw.country_code ?? raw.countryCode).trim() || undefined;
  const country = str(raw.country).trim() || undefined;
  const region = str(raw.region).trim() || undefined;
  const city = str(raw.city).trim() || undefined;
  const rawAsn = raw.asn;
  const asn =
    typeof rawAsn === 'number' && Number.isFinite(rawAsn) && rawAsn > 0
      ? Math.trunc(rawAsn)
      : undefined;
  const isp = str(raw.isp).trim() || undefined;
  const org = str(raw.org).trim() || undefined;
  if (!rawScope && !countryCode && !country && !region && !city && !asn && !isp && !org) {
    return undefined;
  }
  return {
    scope,
    ...(countryCode ? { countryCode } : {}),
    ...(country ? { country } : {}),
    ...(region ? { region } : {}),
    ...(city ? { city } : {}),
    ...(asn !== undefined ? { asn } : {}),
    ...(isp ? { isp } : {}),
    ...(org ? { org } : {}),
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
      clientGeo: normalizeClientGeo(e.client_geo),
      transport: str(e.transport),
      userAgent: str(e.user_agent),
      responseModel: str(e.response_model),
      substituted: e.substituted === true,
      risk: str(e.risk),
      riskReason: str(e.risk_reason),
      riskPrompt: str(e.risk_prompt),
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

/** One quota window instance of a credential with the API-equivalent usage it took. */
export interface UsageQuotaWindow {
  authIndex: string;
  provider: string;
  /** Provider window name (`primary`/`secondary`, `5h`/`7d`); pair windows by `periodSeconds`. */
  window: string;
  periodSeconds: number;
  /** Nominal window start (resetAt - periodSeconds) in unix seconds. */
  startAt: number;
  resetAt: number;
  /** Highest percentage seen in the window, first seen at `observedAt` (unix ms). */
  usedPercent: number;
  ownPercent: number;
  observedAt: number;
  samples: number;
  /** The credential's usage in the adjusted accounting bounds (from startAt - 30m, not before previous reset, to highest % observedAt, exclusive of resetAt). */
  usage: UsageAggregate;
  /** Usage extrapolated to 100% of the window; null at 0%. */
  fullCost: number | null;
  fullTokens: number | null;
  partial: boolean;
  externalPercent: number;
  externalChecked: boolean;
}

export interface UsageQuotaModelFeature {
  model: string;
  kind: string;
  multiplier: number;
  share: number;
}

export interface UsageQuotaModelValue {
  model: string;
  fullCost: number;
}

export interface UsageQuotaModel {
  authIndex: string;
  provider: string;
  periodSeconds: number;
  status: 'fitted' | 'insufficient';
  windows: number;
  segments: number;
  externalSegments: number;
  costUsed: number;
  pctPerUsd: number | null;
  fullCost: number | null;
  fullCostLow: number | null;
  fullCostHigh: number | null;
  ciPercent: number | null;
  features: UsageQuotaModelFeature[];
  modelValues: UsageQuotaModelValue[];
}

export interface UsageQuotaValueResponse {
  windows: UsageQuotaWindow[];
  models: UsageQuotaModel[];
}

export const normalizeUsageQuotaValue = (data: unknown): UsageQuotaValueResponse => {
  const r = rec(data);
  const windows = list(r.windows).map((w) => {
    const usedPercent = num(w.used_percent);
    const externalPercent = num(w.external_percent);
    const ownPercent = optionalNumber(w.own_percent) ?? usedPercent;
    return {
      authIndex: str(w.auth_index),
      provider: str(w.provider),
      window: str(w.window),
      periodSeconds: num(w.period_seconds),
      startAt: num(w.start_at),
      resetAt: num(w.reset_at),
      usedPercent,
      ownPercent,
      observedAt: num(w.observed_at),
      samples: num(w.samples),
      usage: normalizeAggregate(w.usage),
      fullCost: optionalNumber(w.full_cost) ?? null,
      fullTokens: optionalNumber(w.full_tokens) ?? null,
      partial: w.partial === true,
      externalPercent,
      externalChecked: w.external_checked === true,
    };
  });
  const models = list(r.models).map((m) => ({
    authIndex: str(m.auth_index),
    provider: str(m.provider),
    periodSeconds: num(m.period_seconds),
    status: m.status === 'fitted' ? ('fitted' as const) : ('insufficient' as const),
    windows: num(m.windows),
    segments: num(m.segments),
    externalSegments: num(m.external_segments),
    costUsed: num(m.cost_used),
    pctPerUsd: optionalNumber(m.pct_per_usd) ?? null,
    fullCost: optionalNumber(m.full_cost) ?? null,
    fullCostLow: optionalNumber(m.full_cost_low) ?? null,
    fullCostHigh: optionalNumber(m.full_cost_high) ?? null,
    ciPercent: optionalNumber(m.ci_percent) ?? null,
    features: list(m.features).map((f) => ({
      model: str(f.model),
      kind: str(f.kind),
      multiplier: num(f.multiplier),
      share: num(f.share),
    })),
    modelValues: list(m.model_values).map((mv) => ({
      model: str(mv.model),
      fullCost: num(mv.full_cost),
    })),
  }));
  return { windows, models };
};

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

const USAGE_PATH = '/config/observability/usage';
const STORE_PATH = `${USAGE_PATH}/store`;
// Owned by the core's embeddings patch; it filters both the RESP usage queue and the store.
const EXCLUDE_EMBEDDINGS_PATH = `${USAGE_PATH}/exclude-embeddings`;
const STORE_ENABLE_PATH = `${STORE_PATH}/enable`;
const STORE_DB_PATH = `${STORE_PATH}/path`;
const STORE_RETENTION_PATH = `${STORE_PATH}/retention-days`;
const DISABLE_GEOIP_PATH = `${STORE_PATH}/geoip/disable`;
const DISABLE_RISK_PROMPTS_PATH = `${STORE_PATH}/risk-prompts/disable`;
const OVERRIDES_PATH = `${STORE_PATH}/pricing/overrides`;

/** Max magnitude accepted so Go `time.Duration(days) * 24h` cannot overflow int64. */
export const MAX_RETENTION_DAYS = 36500;

export interface UsageStoreSettings {
  enable: boolean;
  /** SQLite file path; empty uses `usage.db` in the logs directory. */
  path: string;
  /** Event retention in days; 0 uses the 30-day default, negative keeps forever. */
  retentionDays: number;
  /** Stops sending new public client IPs to the online lookup when true. */
  disableGeoip: boolean;
  /** Stops storing the prompt of requests the upstream flagged when true. */
  disableRiskPrompts: boolean;
  /** `observability.usage.exclude-embeddings`: leaves /v1/embeddings requests out of usage. */
  excludeEmbeddings: boolean;
}

export interface UsageGeoipStatus {
  enabled: boolean;
  /** Online lookup service the core asks, e.g. "ip.sb". */
  provider: string;
  /** Distinct public client IPs with a stored answer. */
  resolved: number;
  /** Public client IPs still waiting for a lookup. */
  pending: number;
  lastLookupAt: string | null;
  lastError: string;
}

export const normalizeUsageGeoipStatus = (data: unknown): UsageGeoipStatus => {
  const d = rec(data);
  return {
    enabled: d.enabled !== false,
    provider: str(d.provider),
    resolved: Math.max(0, Math.trunc(num(d.resolved))),
    pending: Math.max(0, Math.trunc(num(d.pending))),
    lastLookupAt: d.last_lookup_at ? str(d.last_lookup_at) : null,
    lastError: str(d.last_error),
  };
};

export interface UsageStorageOptimize {
  running: boolean;
  /** Events older than this many days were deleted first; 0 kept the retention setting. */
  keepDays: number;
  /** Unix ms, 0 when never. */
  startedAt: number;
  finishedAt: number;
  beforeBytes: number;
  afterBytes: number;
  deletedEvents: number;
  error: string;
}

export interface UsageStorageStatus {
  path: string;
  fileBytes: number;
  walBytes: number;
  /** Pages freed by deletes; reused for new data, returned to the disk only by an optimize. */
  freeBytes: number;
  events: number;
  /** Unix ms of the oldest stored event, 0 without events. */
  oldestEvent: number;
  eventsPerDay: number;
  /** Estimated new data per day (an upper estimate: rollups count toward the per-event size). */
  growthBytesPerDay: number;
  retentionDays: number;
  optimize: UsageStorageOptimize;
}

const count = (value: unknown) => Math.max(0, Math.trunc(num(value)));

export const normalizeUsageStorage = (data: unknown): UsageStorageStatus => {
  const d = rec(data);
  const o = rec(d.optimize);
  return {
    path: str(d.path),
    fileBytes: count(d.file_bytes),
    walBytes: count(d.wal_bytes),
    freeBytes: count(d.free_bytes),
    events: count(d.events),
    oldestEvent: count(d.oldest_event),
    eventsPerDay: Math.max(0, num(d.events_per_day)),
    growthBytesPerDay: count(d.growth_bytes_per_day),
    retentionDays: Math.trunc(num(d.retention_days)),
    optimize: {
      running: o.running === true,
      keepDays: count(o.keep_days),
      startedAt: count(o.started_at),
      finishedAt: count(o.finished_at),
      beforeBytes: count(o.before_bytes),
      afterBytes: count(o.after_bytes),
      deletedEvents: count(o.deleted_events),
      error: str(o.error),
    },
  };
};

/** Upper bound the core accepts for `keep_days`. */
export const MAX_OPTIMIZE_KEEP_DAYS = 3650;

export interface UsageStoreSettingsMutation {
  /** Merged into `observability.usage.store`. */
  patch: Record<string, unknown>;
  /** Full config paths to set, outside the store subtree. */
  puts: Record<string, unknown>;
  deletions: string[];
}

/** `data` is the `observability.usage.store` subtree; `excludeEmbeddings` its sibling flag. */
export const normalizeUsageStoreSettings = (
  data: unknown,
  excludeEmbeddings: unknown = false
): UsageStoreSettings => {
  const d = rec(data);
  const geoip = rec(d.geoip);
  const riskPrompts = rec(d['risk-prompts']);
  const rawRetention = d['retention-days'];
  const retentionDays =
    typeof rawRetention === 'number' && Number.isFinite(rawRetention)
      ? Math.trunc(rawRetention)
      : 0;
  return {
    enable: d.enable === true,
    path: str(d.path).trim(),
    retentionDays,
    disableGeoip: geoip.disable === true,
    disableRiskPrompts: riskPrompts.disable === true,
    excludeEmbeddings: excludeEmbeddings === true,
  };
};

/**
 * Builds the minimal PATCH + DELETE plan for `observability.usage.store` so unset optional
 * fields are removed with DELETE instead of persisted as empty defaults, while sibling
 * fields such as `pricing.overrides` and `pricing.disable-models-dev` (YAML-only) remain untouched.
 */
export const serializeUsageStoreSettings = (
  next: UsageStoreSettings,
  previous?: UsageStoreSettings
): UsageStoreSettingsMutation => {
  if (!Number.isInteger(next.retentionDays) || Math.abs(next.retentionDays) > MAX_RETENTION_DAYS) {
    throw new RangeError('retention-days must be an integer within ±36500');
  }
  const path = next.path.trim();
  const patch: Record<string, unknown> = {};
  const puts: Record<string, unknown> = {};
  const deletions: string[] = [];

  if (!previous || previous.enable !== next.enable) {
    patch.enable = next.enable;
  }

  if (path !== '') {
    if (!previous || previous.path !== path) patch.path = path;
  } else if (!previous || previous.path !== '') {
    deletions.push(STORE_DB_PATH);
  }

  if (next.retentionDays !== 0) {
    if (!previous || previous.retentionDays !== next.retentionDays) {
      patch['retention-days'] = next.retentionDays;
    }
  } else if (!previous || previous.retentionDays !== 0) {
    deletions.push(STORE_RETENTION_PATH);
  }

  if (next.disableGeoip) {
    if (!previous || !previous.disableGeoip) {
      patch.geoip = { disable: true };
    }
  } else if (!previous || previous.disableGeoip) {
    deletions.push(DISABLE_GEOIP_PATH);
  }

  if (next.disableRiskPrompts) {
    if (!previous || !previous.disableRiskPrompts) {
      patch['risk-prompts'] = { disable: true };
    }
  } else if (!previous || previous.disableRiskPrompts) {
    deletions.push(DISABLE_RISK_PROMPTS_PATH);
  }

  if (next.excludeEmbeddings) {
    if (!previous || !previous.excludeEmbeddings) puts[EXCLUDE_EMBEDDINGS_PATH] = true;
  } else if (!previous || previous.excludeEmbeddings) {
    deletions.push(EXCLUDE_EMBEDDINGS_PATH);
  }

  return { patch, puts, deletions };
};

const deleteOptionalConfig = async (path: string) => {
  try {
    await apiClient.delete(path);
  } catch (error) {
    if (!isMissingConfigValue(error)) throw error;
  }
};

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
          risk: filter.risk,
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
  getQuotaValue: async (
    from: number,
    to: number,
    authIndex?: string[]
  ): Promise<UsageQuotaValueResponse> =>
    normalizeUsageQuotaValue(
      await apiClient.get('/observability/usage/quota-value', {
        params: buildUsageParams({ from, to, auth_index: authIndex }),
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
          risk: query.risk,
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
        risk: query.risk,
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
  getGeoipStatus: async (): Promise<UsageGeoipStatus | null> => {
    try {
      return normalizeUsageGeoipStatus(await apiClient.get('/observability/usage/geoip'));
    } catch (error) {
      if (isRecord(error) && error.status === 404) return null;
      throw error;
    }
  },
  /** Null when the core predates the storage endpoint. */
  getStorage: async (): Promise<UsageStorageStatus | null> => {
    try {
      return normalizeUsageStorage(await apiClient.get('/observability/usage/storage'));
    } catch (error) {
      if (isRecord(error) && error.status === 404) return null;
      throw error;
    }
  },
  /** Starts an optimize in the background; poll getStorage until `optimize.running` clears. */
  optimizeStorage: async (keepDays: number) =>
    normalizeUsageStorage(
      await apiClient.post('/observability/usage/storage/optimize', { keep_days: keepDays })
    ),
  getSettings: async () => {
    const usage = rec(await getConfigValue<unknown>(USAGE_PATH, {}));
    return normalizeUsageStoreSettings(usage.store, usage['exclude-embeddings']);
  },
  saveSettings: async (next: UsageStoreSettings, previous?: UsageStoreSettings) => {
    const assertConnection = guardConfigConnection();
    const { patch, puts, deletions } = serializeUsageStoreSettings(next, previous);
    const runPatch = async () => {
      if (Object.keys(patch).length > 0) {
        assertConnection();
        await apiClient.patch(STORE_PATH, patch);
      }
      // Last: a core without the embeddings patch rejects this path (400), and the store
      // settings above must still be saved.
      for (const [path, value] of Object.entries(puts)) {
        assertConnection();
        await apiClient.put(path, value);
      }
    };
    const runDeletions = async () => {
      for (const path of deletions) {
        assertConnection();
        await deleteOptionalConfig(path);
      }
    };
    // Close first when disabling so deleting `path` cannot briefly open default `usage.db`;
    // otherwise delete stale fields before patching `enable: true`.
    if (patch.enable === false) {
      await runPatch();
      await runDeletions();
    } else {
      await runDeletions();
      await runPatch();
    }
  },
  setEnabled: (enabled: boolean) => apiClient.put(STORE_ENABLE_PATH, enabled),
  enable: () => apiClient.put(STORE_ENABLE_PATH, true),
};
