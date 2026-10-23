import type { UsageEventsQuery, UsagePriceOverride } from '@/services/api/usageStore';
import type { UsageWindow } from './UsagePage';

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
  'tier',
  'endpoint',
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
  filter: EventsFilter
): UsageEventsQuery => ({
  from: usageWindow.from,
  to: usageWindow.to,
  model: filter.model,
  provider: filter.provider,
  apiKeyId: filter.api_key_id,
  authIndex: filter.auth_index,
  failed: filter.result === 'failed' ? true : filter.result === 'success' ? false : undefined,
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
