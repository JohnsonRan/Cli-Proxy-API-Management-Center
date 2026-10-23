import type { ReactNode } from 'react';
import type { UsageEventsQuery, UsagePriceOverride } from '@/services/api/usageStore';
import { isUsageRange, type UsageRange } from './format';
import type { UsageWindow } from './UsagePage';

/** Global dimension and range filters applied across all usage views. */
export interface UsageGlobalFilter {
  range: UsageRange;
  customFrom?: number;
  customTo?: number;
  models: string[];
  providers: string[];
  apiKeyIds: string[];
  authIndexes: string[];
}

export const emptyGlobalFilter = (): UsageGlobalFilter => ({
  range: '24h',
  models: [],
  providers: [],
  apiKeyIds: [],
  authIndexes: [],
});

export const hasActiveGlobalFilters = (filter: UsageGlobalFilter): boolean =>
  filter.range !== '24h' ||
  filter.models.length > 0 ||
  filter.providers.length > 0 ||
  filter.apiKeyIds.length > 0 ||
  filter.authIndexes.length > 0;

export const parseCommaList = (value: string | null): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

export const parseGlobalFilterFromSearchParams = (params: URLSearchParams): UsageGlobalFilter => {
  const rangeParam = params.get('range');
  const range: UsageRange = isUsageRange(rangeParam) ? rangeParam : '24h';
  const fromParam = params.get('from');
  const toParam = params.get('to');
  const fromNum = fromParam ? Number(fromParam) : NaN;
  const toNum = toParam ? Number(toParam) : NaN;
  const customFrom = Number.isFinite(fromNum) ? fromNum : undefined;
  const customTo = Number.isFinite(toNum) ? toNum : undefined;

  return {
    range,
    customFrom,
    customTo,
    models: parseCommaList(params.get('model')),
    providers: parseCommaList(params.get('provider')),
    apiKeyIds: parseCommaList(params.get('api_key_id')),
    authIndexes: parseCommaList(params.get('auth_index')),
  };
};

export const serializeGlobalFilterToSearchParams = (
  filter: UsageGlobalFilter,
  tab?: string,
  result?: string
): URLSearchParams => {
  const params = new URLSearchParams();
  if (tab) params.set('tab', tab);
  if (filter.range && filter.range !== '24h') params.set('range', filter.range);
  if (filter.range === 'custom') {
    if (filter.customFrom !== undefined) params.set('from', String(filter.customFrom));
    if (filter.customTo !== undefined) params.set('to', String(filter.customTo));
  }
  if (filter.models.length) params.set('model', filter.models.join(','));
  if (filter.providers.length) params.set('provider', filter.providers.join(','));
  if (filter.apiKeyIds.length) params.set('api_key_id', filter.apiKeyIds.join(','));
  if (filter.authIndexes.length) params.set('auth_index', filter.authIndexes.join(','));
  if (result) params.set('result', result);
  return params;
};

export interface MultiSelectOption {
  value: string;
  label: string;
  renderLabel?: ReactNode;
  requests?: number;
}

export const filterMultiSelectOptions = (
  options: MultiSelectOption[],
  search: string
): MultiSelectOption[] => {
  const query = search.trim().toLowerCase();
  if (!query) return options;
  return options.filter(
    (o) => o.value.toLowerCase().includes(query) || o.label.toLowerCase().includes(query)
  );
};

export const mergeSelectedOptions = (
  options: MultiSelectOption[],
  selected: string[]
): MultiSelectOption[] => {
  const existing = new Set(options.map((o) => o.value));
  const missing: MultiSelectOption[] = [];
  for (const s of selected) {
    if (s && !existing.has(s)) {
      missing.push({ value: s, label: s });
      existing.add(s);
    }
  }
  return missing.length ? [...missing, ...options] : options;
};

/** Histogram bucket labels such as "≤0.5s", "1–2s" and ">60s". */
export const histogramLabels = (boundsMs: number[]): string[] => {
  const sec = (ms: number) => `${ms / 1000}s`;
  return [
    ...boundsMs.map((bound, i) =>
      i === 0 ? `≤${sec(bound)}` : `${sec(boundsMs[i - 1])}–${sec(bound)}`
    ),
    `>${sec(boundsMs[boundsMs.length - 1] ?? 0)}`,
  ];
};

/** Event filters as carried in the URL search params. */
export interface EventsFilter {
  model?: string;
  provider?: string;
  api_key_id?: string;
  auth_index?: string;
  result?: string;
}

export const EVENT_COLUMNS = [
  'time',
  'status',
  'model',
  'route',
  'tokens',
  'latency',
  'cost',
  'client',
] as const;
export type EventColumn = (typeof EVENT_COLUMNS)[number];
export const DEFAULT_EVENT_COLUMNS: EventColumn[] = [
  'time',
  'status',
  'model',
  'route',
  'tokens',
  'latency',
  'cost',
];

export const readEventColumns = (raw: string | null): EventColumn[] => {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      const valid = EVENT_COLUMNS.filter((c) => parsed.includes(c));
      if (valid.length > 0) return valid;
    }
  } catch {
    // Fall through to the defaults on corrupt storage.
  }
  return DEFAULT_EVENT_COLUMNS;
};

export const toEventsQuery = (
  usageWindow: UsageWindow,
  globalFilter: UsageGlobalFilter,
  resultFilter?: string
): UsageEventsQuery => ({
  from: usageWindow.from,
  to: usageWindow.to,
  model: globalFilter.models.length ? globalFilter.models : undefined,
  provider: globalFilter.providers.length ? globalFilter.providers : undefined,
  apiKeyId: globalFilter.apiKeyIds.length ? globalFilter.apiKeyIds : undefined,
  authIndex: globalFilter.authIndexes.length ? globalFilter.authIndexes : undefined,
  failed: resultFilter === 'failed' ? true : resultFilter === 'success' ? false : undefined,
  substituted: resultFilter === 'substituted' ? true : undefined,
});

/** Editable row: prices stay strings while typing so "0." and "" are not coerced away. */
export interface DraftRow {
  model: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
}

export const toDraft = (o: UsagePriceOverride): DraftRow => ({
  model: o.model,
  input: String(o.input),
  output: String(o.output),
  cacheRead: o.cacheRead === undefined ? '' : String(o.cacheRead),
  cacheWrite: o.cacheWrite === undefined ? '' : String(o.cacheWrite),
});

export const PRICE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;

/** Parses draft rows; returns the index of the first invalid row instead when one fails. */
export const parseDraftRows = (
  rows: DraftRow[]
): { overrides: UsagePriceOverride[] } | { invalidRow: number } => {
  const overrides: UsagePriceOverride[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const model = row.model.trim();
    if (!model && PRICE_FIELDS.every((f) => !row[f].trim())) continue;
    const parse = (value: string, optional: boolean) => {
      if (!value.trim()) return optional ? undefined : NaN;
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? n : NaN;
    };
    const input = parse(row.input, false);
    const output = parse(row.output, false);
    const cacheRead = parse(row.cacheRead, true);
    const cacheWrite = parse(row.cacheWrite, true);
    const key = model.toLowerCase();
    if (
      !model ||
      seen.has(key) ||
      [input, output, cacheRead, cacheWrite].some((v) => v !== undefined && Number.isNaN(v))
    ) {
      return { invalidRow: i };
    }
    seen.add(key);
    overrides.push({
      model,
      input: input as number,
      output: output as number,
      cacheRead,
      cacheWrite,
    });
  }
  return { overrides };
};

export const emptyRow = (): DraftRow => ({
  model: '',
  input: '',
  output: '',
  cacheRead: '',
  cacheWrite: '',
});

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * Appends a fallback option for `value` if it is not already in `options`,
 * ensuring URL-seeded or stale filters still render a readable label in Select.
 */
export const withSelectedOption = (
  options: FilterOption[],
  value: string | undefined | null
): FilterOption[] => {
  if (!value || options.some((opt) => opt.value === value)) {
    return options;
  }
  return [...options, { value, label: value }];
};

const COMPAT_PREFIX = 'openai-compatible-';

/** How a usage provider key is shown: OpenAI-compatible upstreams by their configured name. */
export const providerDisplay = (
  provider: string
): { type: string; name: string | null; compat: boolean } => {
  const key = provider.trim();
  if (key.toLowerCase().startsWith(COMPAT_PREFIX)) {
    return { type: 'openai', name: key.slice(COMPAT_PREFIX.length), compat: true };
  }
  // gemini-cli and similar share the Gemini brand.
  const type = key.toLowerCase().startsWith('gemini') ? 'gemini' : key;
  return { type, name: null, compat: false };
};

/** The usage store groups client keys by the first 12 hex chars of their SHA-256. */
export const clientKeyId = (sha256Hex: string) => sha256Hex.slice(0, 12);

/**
 * Reads `access.api-keys`, whose entries are plain strings or `{ api-key, name, ... }` objects
 * when the config gives a key a display name.
 */
export const clientKeyEntries = (raw: unknown): { key: string; name?: string }[] => {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry === 'string') return entry.trim() ? [{ key: entry.trim() }] : [];
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const key = String(record['api-key'] ?? record.key ?? '').trim();
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      return key ? [{ key, ...(name ? { name } : {}) }] : [];
    }
    return [];
  });
};

/** Realtime feed cap: older rows fall off the bottom. */
export const REALTIME_FEED_LIMIT = 100;

/**
 * Merges an ascending `after` page into a newest-first feed, dropping duplicates and keeping
 * at most `limit` rows. Returns the merged feed and the ids that are new.
 */
export const mergeRealtimeFeed = <T extends { id: number }>(
  feed: T[],
  ascendingPage: T[],
  limit = REALTIME_FEED_LIMIT
): { feed: T[]; added: number[] } => {
  const known = new Set(feed.map((e) => e.id));
  const fresh = ascendingPage.filter((e) => !known.has(e.id)).reverse();
  return { feed: [...fresh, ...feed].slice(0, limit), added: fresh.map((e) => e.id) };
};

export type EventDimension = 'model' | 'provider' | 'api_key_id' | 'auth_index';

export type EventTransport = 'ws' | 'sse' | 'http';

/**
 * Downstream transport of a request. Model-call routes are POST over HTTP; the WebSocket
 * routes (/v1/responses, /v1/realtime, ...) are GET upgrades, so a GET endpoint means WebSocket.
 */
export const eventTransport = (endpoint: string, stream: boolean): EventTransport => {
  if (endpoint.trim().toUpperCase().startsWith('GET ')) return 'ws';
  return stream ? 'sse' : 'http';
};

/** Share of input tokens read from cache, or null when the request had no input. */
export const eventCacheHitRate = (tokens: {
  inputUncached: number;
  cacheRead: number;
  cacheWrite: number;
}): number | null => {
  const input = tokens.inputUncached + tokens.cacheRead + tokens.cacheWrite;
  return input > 0 ? (tokens.cacheRead / input) * 100 : null;
};
