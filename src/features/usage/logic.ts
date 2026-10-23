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
  'model',
  'provider',
  'credential',
  'key',
  'status',
  'latency',
  'ttft',
  'input',
  'cached',
  'output',
  'cost',
  'tier',
  'endpoint',
  'client',
] as const;
export type EventColumn = (typeof EVENT_COLUMNS)[number];
export const DEFAULT_EVENT_COLUMNS: EventColumn[] = [
  'time',
  'model',
  'credential',
  'key',
  'status',
  'latency',
  'input',
  'output',
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
