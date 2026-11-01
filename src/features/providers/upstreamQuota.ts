/**
 * Upstream quota passthrough: reads the GET /v1/usage summary of a provider whose
 * base URL points at another CLIProxyAPI, using the provider's own API key through
 * the management api-call. React-free so tests consume it directly.
 */

import type { TFunction } from 'i18next';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import type { OpenAIProviderConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import { QUOTA_RELAY_PROVIDER } from '@/utils/constants';
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

const KNOWN_WINDOWS = new Set([
  'five_hour',
  'weekly',
  'monthly',
  'seven_day',
  'seven_day_opus',
  'seven_day_sonnet',
  'seven_day_oauth_apps',
  'seven_day_cowork',
  'seven_day_fable',
  'code_review_five_hour',
  'code_review_weekly',
  'code_review_monthly',
]);

/** A translated name for the core's window ids; anything else keeps the upstream label. */
export const upstreamWindowLabel = (t: TFunction, window: UpstreamQuotaWindow): string => {
  const known = KNOWN_WINDOWS.has(window.id)
    ? t(`providersPage.upstreamQuota.windows.${window.id}`)
    : null;
  return window.label && !known ? window.label : (known ?? window.label ?? window.id);
};

const KNOWN_BALANCES = new Set([
  'credits',
  'rate_limit_resets',
  'extra_usage',
  'on_demand',
  'prepaid',
]);

export const upstreamBalanceLabel = (t: TFunction, balance: UpstreamQuotaBalance): string =>
  KNOWN_BALANCES.has(balance.id)
    ? t(`providersPage.upstreamQuota.balances.${balance.id}`)
    : (balance.label ?? balance.id);

const formatAmount = (value: number, unit: string | null): string => {
  const rounded = Math.round(value * 100) / 100;
  if (!unit || unit === 'count' || unit === 'credits') return String(rounded);
  if (unit === 'usd') return `$${rounded}`;
  return `${rounded} ${unit.toUpperCase()}`;
};

export const upstreamBalanceValue = (t: TFunction, balance: UpstreamQuotaBalance): string => {
  if (balance.unlimited) return t('providersPage.upstreamQuota.unlimited');
  if (balance.remaining !== null && balance.limit !== null) {
    return t('providersPage.upstreamQuota.remainingOf', {
      remaining: formatAmount(balance.remaining, balance.unit),
      limit: formatAmount(balance.limit, balance.unit),
    });
  }
  if (balance.remaining !== null) return formatAmount(balance.remaining, balance.unit);
  if (balance.used !== null) {
    return t('providersPage.upstreamQuota.usedAmount', {
      used: formatAmount(balance.used, balance.unit),
    });
  }
  return t('providersPage.upstreamQuota.unknown');
};

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

export interface UpstreamQuotaAccount {
  credential: UpstreamQuotaCredential;
  /** Name of the relay the account sits behind, or null when the upstream owns it. */
  via: string | null;
  /** Stable position in the summary tree, unique within one result. */
  path: string;
}

/**
 * The accounts in a summary, depth first. A relay is a proxy rather than an account, so
 * it contributes only the accounts behind it; an errored relay stays, to show its error.
 */
export const flattenUpstreamAccounts = (
  credentials: UpstreamQuotaCredential[],
  via: string | null = null,
  path = ''
): UpstreamQuotaAccount[] =>
  credentials.flatMap((credential, index) => {
    const at = `${path}/${index}`;
    const relay = credential.provider === QUOTA_RELAY_PROVIDER;
    const own =
      !relay || (credential.status === 'error' && credential.upstream.length === 0)
        ? [{ credential, via, path: at }]
        : [];
    return [...own, ...flattenUpstreamAccounts(credential.upstream, credential.name, at)];
  });

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
