import type { ReactNode } from 'react';
import {
  MAX_RETENTION_DAYS,
  type ClientGeo,
  type UsageEventsQuery,
  type UsageModelPrice,
  type UsagePriceOverride,
  type UsageStoreSettings,
} from '@/services/api/usageStore';
import {
  USAGE_METRICS,
  isUsageRange,
  isUsageTab,
  type UsageMetric,
  type UsageRange,
  type UsageTab,
} from './format';
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

const overrideKey = (model: string) => model.trim().toLowerCase();

/** An effective-price row together with the configured override that applies to it, if any. */
export interface PricingRow extends UsageModelPrice {
  override: UsagePriceOverride | null;
}

/**
 * Effective prices of the stored models plus overrides for models with no usage yet (the
 * backend lists only stored models), so every override stays visible and editable.
 */
export const pricingRows = (
  models: UsageModelPrice[],
  overrides: UsagePriceOverride[]
): PricingRow[] => {
  const byKey = new Map(overrides.map((o) => [overrideKey(o.model), o]));
  const rows: PricingRow[] = models.map((m) => ({
    ...m,
    override: byKey.get(overrideKey(m.model)) ?? null,
  }));
  const listed = new Set(models.map((m) => overrideKey(m.model)));
  for (const key of byKey.keys()) {
    if (listed.has(key)) continue;
    // byKey keeps the last of several case variants, the one the backend applies.
    const o = byKey.get(key) as UsagePriceOverride;
    rows.push({
      model: o.model,
      source: 'override',
      price: {
        input: o.input,
        output: o.output,
        cacheRead: o.cacheRead ?? o.input,
        cacheWrite: o.cacheWrite ?? o.input,
      },
      override: o,
    });
  }
  return rows;
};

/**
 * Returns the override list with `model`'s override replaced by `next` (case-insensitive),
 * or removed when `next` is null. An override for `next.model` is replaced as well.
 */
export const replaceOverride = (
  overrides: UsagePriceOverride[],
  model: string,
  next: UsagePriceOverride | null
): UsagePriceOverride[] => {
  const drop = new Set([model, next?.model ?? ''].filter((m) => m.trim()).map(overrideKey));
  const rest = overrides.filter((o) => !drop.has(overrideKey(o.model)));
  return next ? [...rest, next] : rest;
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

/**
 * In-flight calls still to show: an HTTP call whose finished event already reached the feed
 * (the realtime and events polls run in parallel) is dropped. WebSocket sessions record one
 * event per turn under the same request id while still open, so they always stay.
 */
export const visibleInFlight = <T extends { requestId: string; transport: string }>(
  inFlight: T[],
  feed: { requestId: string }[]
): T[] => {
  const finished = new Set(feed.map((e) => e.requestId).filter(Boolean));
  return inFlight.filter((r) => r.transport === 'ws' || !r.requestId || !finished.has(r.requestId));
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
 * Downstream transport of a request: the value the core recorded, or for older rows an
 * inference (model-call routes are POST; WebSocket routes are GET upgrades).
 */
export const eventTransport = (
  endpoint: string,
  stream: boolean,
  recorded = ''
): EventTransport => {
  if (recorded === 'ws' || recorded === 'sse' || recorded === 'http') return recorded;
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

export type SortDir = 'asc' | 'desc';
export interface SortState {
  key: string;
  dir: SortDir;
}

/**
 * Next sort after clicking a column: a new column starts in its natural direction (A→Z for
 * text, largest first for numbers), a second click reverses it, a third restores the default.
 */
export const nextSort = (
  current: SortState | null,
  key: string,
  text = false
): SortState | null => {
  const first: SortDir = text ? 'asc' : 'desc';
  if (current?.key !== key) return { key, dir: first };
  return current.dir === first ? { key, dir: first === 'asc' ? 'desc' : 'asc' } : null;
};

/** Stable sort by `value`; rows without a value (null) always go last. */
export const sortRows = <T>(
  rows: readonly T[],
  value: ((row: T) => number | string | null) | undefined,
  dir: SortDir
): T[] => {
  if (!value) return [...rows];
  const factor = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, key: value(row) }))
    .sort((a, b) => {
      if (a.key === null || b.key === null) {
        if (a.key === b.key) return a.index - b.index;
        return a.key === null ? 1 : -1;
      }
      const diff =
        typeof a.key === 'string' || typeof b.key === 'string'
          ? String(a.key).localeCompare(String(b.key))
          : a.key - b.key;
      return diff !== 0 ? diff * factor : a.index - b.index;
    })
    .map((item) => item.row);
};

const csvCell = (value: string | number): string => {
  let text = String(value);
  // Keep spreadsheet apps from evaluating names such as "=cmd" as formulas.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** CSV text with a BOM so spreadsheet apps read non-ASCII headers as UTF-8. */
export const toCsv = (rows: (string | number)[][]): string =>
  `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;

/** Auto-refresh intervals offered on the overview and analysis tabs, in seconds (0 = off). */
export const AUTO_REFRESH_SECONDS = [0, 30, 60, 300] as const;

/** View choices remembered across visits; a link with its own search params still wins. */
export interface UsagePrefs {
  tab?: UsageTab;
  /** Never 'custom': a fixed past window would be stale on the next visit. */
  range?: Exclude<UsageRange, 'custom'>;
  metric?: UsageMetric;
  autoRefresh?: number;
  comparePrevious?: boolean;
}

const PREFS_STORAGE_KEY = 'cpamc-usage-prefs:v1';

/** Keeps only valid fields so corrupt or outdated storage cannot break the page. */
export const parseUsagePrefs = (raw: string | null): UsagePrefs => {
  let value: unknown;
  try {
    value = raw ? JSON.parse(raw) : null;
  } catch {
    return {};
  }
  if (!value || typeof value !== 'object') return {};
  const v = value as Record<string, unknown>;
  const prefs: UsagePrefs = {};
  if (typeof v.tab === 'string' && isUsageTab(v.tab)) prefs.tab = v.tab;
  if (typeof v.range === 'string' && isUsageRange(v.range) && v.range !== 'custom') {
    prefs.range = v.range;
  }
  if ((USAGE_METRICS as readonly unknown[]).includes(v.metric)) {
    prefs.metric = v.metric as UsageMetric;
  }
  if ((AUTO_REFRESH_SECONDS as readonly unknown[]).includes(v.autoRefresh)) {
    prefs.autoRefresh = v.autoRefresh as number;
  }
  if (typeof v.comparePrevious === 'boolean') prefs.comparePrevious = v.comparePrevious;
  return prefs;
};

export const readUsagePrefs = (): UsagePrefs =>
  parseUsagePrefs(
    typeof localStorage === 'undefined' ? null : localStorage.getItem(PREFS_STORAGE_KEY)
  );

export const saveUsagePrefs = (patch: UsagePrefs) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ ...readUsagePrefs(), ...patch }));
  } catch {
    // Storage may be full or blocked; preferences are only a convenience.
  }
};

/**
 * Rough USD saved by cache reads: each read token billed at the cache-read price instead of
 * the input price. Uses each model's standard price, so tiers and long-context rates are
 * ignored; cache writes are not subtracted. Returns 0 without priced cache reads.
 */
export const cacheSavings = (
  models: readonly { model: string; tokens: { cacheRead: number } }[],
  prices: readonly UsageModelPrice[]
): number => {
  const byModel = new Map(prices.map((p) => [p.model, p.price]));
  return models.reduce((sum, m) => {
    const price = byModel.get(m.model);
    if (!price || m.tokens.cacheRead <= 0) return sum;
    return sum + (m.tokens.cacheRead * Math.max(0, price.input - price.cacheRead)) / 1e6;
  }, 0);
};

/**
 * Pairs previous-window buckets with current ones from the trailing edge, because windows
 * of equal length can differ by one leading bucket when the backend floors window starts
 * to the hour/day boundary. Shorter previous series produce undefined for leading buckets.
 */
export const alignPrevious = <T>(
  current: readonly unknown[],
  previous: readonly T[]
): (T | undefined)[] => {
  const offset = previous.length - current.length;
  return current.map((_, i) => {
    const prevIndex = i + offset;
    return prevIndex >= 0 && prevIndex < previous.length ? previous[prevIndex] : undefined;
  });
};

export interface StoreSettingsDraft {
  enable: boolean;
  path: string;
  retentionDays: string;
  disableModelsDev: boolean;
  disableGeoip: boolean;
}

export const toStoreSettingsDraft = (settings: UsageStoreSettings): StoreSettingsDraft => ({
  enable: settings.enable,
  path: settings.path,
  retentionDays: settings.retentionDays === 0 ? '' : String(settings.retentionDays),
  disableModelsDev: settings.disableModelsDev,
  disableGeoip: settings.disableGeoip,
});

export const parseRetentionDays = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (trimmed === '') return 0;
  if (!/^-?\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || Math.abs(n) > MAX_RETENTION_DAYS) return null;
  return n;
};

export const parseStoreSettingsDraft = (
  draft: StoreSettingsDraft
): { settings: UsageStoreSettings } | { error: 'retentionDays' } => {
  const retentionDays = parseRetentionDays(draft.retentionDays);
  if (retentionDays === null) return { error: 'retentionDays' };
  return {
    settings: {
      enable: draft.enable,
      path: draft.path.trim(),
      retentionDays,
      disableModelsDev: draft.disableModelsDev,
      disableGeoip: draft.disableGeoip,
    },
  };
};

export const isStoreSettingsDirty = (
  draft: StoreSettingsDraft,
  saved: UsageStoreSettings
): boolean => {
  const retentionDays = parseRetentionDays(draft.retentionDays);
  if (retentionDays === null) return true;
  return (
    draft.enable !== saved.enable ||
    draft.path.trim() !== saved.path ||
    retentionDays !== saved.retentionDays ||
    draft.disableModelsDev !== saved.disableModelsDev ||
    draft.disableGeoip !== saved.disableGeoip
  );
};

export const formatClientGeoLine = (
  geo: ClientGeo | undefined,
  language?: string,
  t?: (key: string) => string
): string => {
  if (!geo) return '';
  if (geo.scope === 'private') {
    return t ? t('usage_stats.client_scope_private') : 'Private network';
  }
  if (geo.scope === 'loopback') {
    return t ? t('usage_stats.client_scope_loopback') : 'Loopback';
  }

  let country = geo.country || '';
  if (geo.countryCode && language && typeof Intl !== 'undefined' && Intl.DisplayNames) {
    try {
      const dn = new Intl.DisplayNames([language], { type: 'region' });
      const localized = dn.of(geo.countryCode);
      if (localized) country = localized;
    } catch {
      // Fall back to geo.country
    }
  }

  const cityOrRegion = geo.city || geo.region || '';
  const loc = country && cityOrRegion ? `${country}, ${cityOrRegion}` : country || cityOrRegion;

  // The organization names the actual network (e.g. "Open Computer Network"); the ISP is the fallback.
  const owner = geo.org || geo.isp;
  if (owner) {
    return loc ? `${loc} · ${owner}` : owner;
  }
  return loc;
};

export const formatDetailLocation = (
  geo: ClientGeo | undefined,
  language?: string,
  t?: (key: string) => string
): string => {
  if (!geo) return '';
  if (geo.scope === 'private') {
    return t ? t('usage_stats.client_scope_private') : 'Private network';
  }
  if (geo.scope === 'loopback') {
    return t ? t('usage_stats.client_scope_loopback') : 'Loopback';
  }
  let country = geo.country || '';
  if (geo.countryCode && language && typeof Intl !== 'undefined' && Intl.DisplayNames) {
    try {
      const dn = new Intl.DisplayNames([language], { type: 'region' });
      const localized = dn.of(geo.countryCode);
      if (localized) country = localized;
    } catch {
      // Fall back to geo.country
    }
  }
  const parts = [country, geo.region, geo.city].filter(Boolean) as string[];
  const uniqueParts = parts.filter(
    (p, i) => i === 0 || p.toLowerCase() !== parts[i - 1].toLowerCase()
  );
  return uniqueParts.join(', ');
};

export const formatDetailIsp = (geo: ClientGeo | undefined): string => {
  if (!geo) return '';
  const org = geo.org?.trim();
  const isp = geo.isp?.trim();
  const names =
    org && isp && org.toLowerCase() !== isp.toLowerCase() ? `${org} · ${isp}` : org || isp;
  const asn = geo.asn !== undefined && geo.asn > 0 ? `AS${geo.asn}` : '';
  if (names && asn) return `${names} (${asn})`;
  return names || asn || '';
};
