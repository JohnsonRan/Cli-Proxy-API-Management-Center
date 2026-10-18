/**
 * Upstream quota passthrough: reads the GET /v1/usage summary of a provider whose
 * base URL points at another CLIProxyAPI, using the provider's own API key through
 * the management api-call. React-free so tests consume it directly.
 */

import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import type { OpenAIProviderConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import { isRecord } from '@/utils/helpers';
import type { ProviderGroup, ProviderResource } from './types';

export interface UpstreamQuotaWindow {
  id: string;
  label: string | null;
  usedPercent: number | null;
  resetAt: string | null;
  periodSeconds: number | null;
}

export interface UpstreamQuotaBalance {
  id: string;
  label: string | null;
  remaining: number | null;
  used: number | null;
  limit: number | null;
  unit: string | null;
  unlimited: boolean;
  resetAt: string | null;
}

export interface UpstreamQuotaCredential {
  name: string;
  provider: string;
  status: 'ok' | 'error';
  error: string | null;
  observedAt: string | null;
  plan: string | null;
  planExpiresAt: string | null;
  windows: UpstreamQuotaWindow[];
  balances: UpstreamQuotaBalance[];
  /** Accounts behind a relay credential, i.e. a proxy further up. */
  upstream: UpstreamQuotaCredential[];
}

/** Nesting the core produces is bounded at 3 relays; anything deeper is dropped. */
const MAX_DEPTH = 6;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const normalizeWindow = (value: unknown): UpstreamQuotaWindow | null => {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  if (!id) return null;
  return {
    id,
    label: text(value.label),
    usedPercent: finite(value.used_percent),
    resetAt: text(value.reset_at),
    periodSeconds: finite(value.period_seconds),
  };
};

const normalizeBalance = (value: unknown): UpstreamQuotaBalance | null => {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  if (!id) return null;
  return {
    id,
    label: text(value.label),
    remaining: finite(value.remaining),
    used: finite(value.used),
    limit: finite(value.limit),
    unit: text(value.unit),
    unlimited: value.unlimited === true,
    resetAt: text(value.reset_at),
  };
};

const list = <T>(value: unknown, normalize: (item: unknown) => T | null): T[] =>
  Array.isArray(value) ? value.map(normalize).filter((item): item is T => item !== null) : [];

const normalizeCredential = (value: unknown, depth: number): UpstreamQuotaCredential | null => {
  if (!isRecord(value)) return null;
  const provider = text(value.provider) ?? 'unknown';
  return {
    name: text(value.name) ?? provider,
    provider,
    status: value.status === 'error' ? 'error' : 'ok',
    error: text(value.error),
    observedAt: text(value.observed_at),
    plan: text(value.plan),
    planExpiresAt: text(value.plan_expires_at),
    windows: list(value.windows, normalizeWindow),
    balances: list(value.balances, normalizeBalance),
    upstream:
      depth < MAX_DEPTH ? list(value.upstream, (item) => normalizeCredential(item, depth + 1)) : [],
  };
};

/**
 * Parses a GET /v1/usage body. Returns null when the body is not the CLIProxyAPI
 * quota contract (version >= 2 and credentials array), so a provider that merely has
 * some /v1/usage endpoint is not mistaken for an upstream proxy.
 */
export const normalizeUpstreamQuota = (payload: unknown): UpstreamQuotaCredential[] | null => {
  let parsed = payload;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.credentials)) return null;
  const version =
    typeof parsed.version === 'number' && Number.isFinite(parsed.version) ? parsed.version : null;
  if (version === null || version < 2) return null;
  return list(parsed.credentials, (item) => normalizeCredential(item, 0));
};

/** Mirrors the core: OpenAI-style bases end in /v1, Claude-style bases do not. */
export const buildUpstreamQuotaUrl = (baseUrl: string | null | undefined): string | null => {
  const raw = (baseUrl ?? '').trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  let path = url.pathname.replace(/\/+$/, '');
  if (path.toLowerCase().endsWith('/v1')) path = path.slice(0, -3);
  url.pathname = `${path}/v1/usage`;
  url.search = '';
  url.hash = '';
  return url.toString();
};

/** The tightest window decides how close an account is to running out. */
export const lowestRemainingPercent = (credential: UpstreamQuotaCredential): number | null => {
  const own = credential.windows
    .map((window) => (window.usedPercent === null ? null : 100 - window.usedPercent))
    .filter((value): value is number => value !== null);
  const nested = credential.upstream
    .map(lowestRemainingPercent)
    .filter((value): value is number => value !== null);
  const all = [...own, ...nested];
  return all.length > 0 ? Math.max(0, Math.min(...all)) : null;
};

export interface UpstreamQuotaTarget {
  authIndex: string;
  baseUrl: string;
  /** Masked API key of the entry, or null when the config holds none. */
  maskedKey: string | null;
}

/**
 * The keys of one provider that may reach another proxy sharing its quota. Only a custom
 * base URL can be such a proxy, and api-call needs the key's auth index to inject it.
 * Entries sharing an auth index are one credential, so they yield one target.
 */
export const collectUpstreamQuotaTargets = (resource: ProviderResource): UpstreamQuotaTarget[] => {
  const baseUrl = resource.baseUrl?.trim();
  if (!baseUrl) return [];
  const candidates =
    resource.brand === 'openaiCompatibility'
      ? ((resource.raw as OpenAIProviderConfig).apiKeyEntries ?? []).map((entry) => ({
          authIndex: entry.authIndex,
          maskedKey: entry.apiKey ? maskApiKey(entry.apiKey) : null,
        }))
      : [{ authIndex: resource.authIndex, maskedKey: resource.apiKeyPreview }];
  const seen = new Set<string>();
  return candidates.flatMap(({ authIndex, maskedKey }) => {
    const index = authIndex?.trim();
    if (!index || seen.has(index)) return [];
    seen.add(index);
    return [{ authIndex: index, baseUrl, maskedKey }];
  });
};

/** Every provider with at least one key that can check an upstream's quota, in list order. */
export const collectUpstreamQuotaProviders = (
  groups: ProviderGroup[]
): Array<{ resource: ProviderResource; targets: UpstreamQuotaTarget[] }> =>
  groups
    .flatMap((group) => group.resources)
    .map((resource) => ({ resource, targets: collectUpstreamQuotaTargets(resource) }))
    .filter((item) => item.targets.length > 0);

export type UpstreamQuotaResult =
  | { ok: true; credentials: UpstreamQuotaCredential[] }
  | { ok: false; reason: 'unsupported' | 'error'; message: string };

export async function fetchUpstreamQuota(
  authIndex: string,
  baseUrl: string
): Promise<UpstreamQuotaResult> {
  const url = buildUpstreamQuotaUrl(baseUrl);
  if (!url) return { ok: false, reason: 'unsupported', message: '' };
  const result = await apiCallApi.request(
    {
      authIndex,
      method: 'GET',
      url,
      header: { Authorization: 'Bearer $TOKEN$', Accept: 'application/json' },
    },
    { timeout: 30_000 }
  );
  if (result.statusCode === 404) return { ok: false, reason: 'unsupported', message: '' };
  if (result.statusCode < 200 || result.statusCode >= 300) {
    return { ok: false, reason: 'error', message: getApiCallErrorMessage(result) };
  }
  const credentials = normalizeUpstreamQuota(result.body ?? result.bodyText);
  return credentials
    ? { ok: true, credentials }
    : { ok: false, reason: 'unsupported', message: '' };
}
