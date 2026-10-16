/**
 * Which OAuth credentials each client API key may read through core's GET /v1/usage:
 * the `observability.quota-api.keys` config list. A key without an entry sees nothing.
 */
import { apiClient } from './client';
import { getConfigValue } from './configValue';

const PATH = '/config/observability/quota-api/keys';

/** Providers whose quota core's GET /v1/usage reads (aliases included). */
export const QUOTA_API_PROVIDERS = ['codex', 'claude', 'anthropic', 'antigravity', 'xai', 'grok'];

export const isQuotaApiProvider = (provider: unknown): boolean =>
  QUOTA_API_PROVIDERS.includes(
    String(provider ?? '')
      .trim()
      .toLowerCase()
  );

export interface QuotaApiKeyEntry {
  apiKey: string;
  /** Core auth IDs (auth file names). */
  credentials: string[];
}

const normalizeIds = (ids: readonly unknown[]): string[] => [
  ...new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean)),
];

export const parseQuotaApiKeyEntry = (raw: unknown): QuotaApiKeyEntry | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const apiKey = String(record['api-key'] ?? '').trim();
  if (!apiKey) return null;
  const credentials = Array.isArray(record.credentials) ? normalizeIds(record.credentials) : [];
  return { apiKey, credentials };
};

export const serializeQuotaApiKeyEntry = (entry: QuotaApiKeyEntry) => ({
  'api-key': entry.apiKey.trim(),
  credentials: normalizeIds(entry.credentials),
});

/** Credentials visible to `apiKey`; core merges entries that repeat a key, so do the same. */
export const quotaCredentialsForKey = (
  entries: readonly QuotaApiKeyEntry[],
  apiKey: string
): string[] => {
  const key = apiKey.trim();
  return normalizeIds(
    entries.filter((entry) => entry.apiKey.trim() === key).flatMap((entry) => entry.credentials)
  );
};

/**
 * The list after saving key `nextKey` with `credentials`. `previousKey` is the key's value
 * before an edit, so a renamed key keeps its selection and the old value keeps nothing.
 */
export const withQuotaCredentials = (
  entries: readonly QuotaApiKeyEntry[],
  previousKey: string | null,
  nextKey: string,
  credentials: readonly string[]
): QuotaApiKeyEntry[] => {
  const replaced = new Set([nextKey.trim(), previousKey?.trim() ?? ''].filter(Boolean));
  const isReplaced = (entry: QuotaApiKeyEntry) => replaced.has(entry.apiKey.trim());
  const kept = entries.filter((entry) => !isReplaced(entry));
  const ids = normalizeIds(credentials);
  if (ids.length === 0) return kept;
  // Keep the entry where it was so an unchanged save produces an identical list.
  const first = entries.findIndex(isReplaced);
  const at = first >= 0 ? first : kept.length;
  return [...kept.slice(0, at), { apiKey: nextKey.trim(), credentials: ids }, ...kept.slice(at)];
};

export const sameQuotaApiKeys = (
  left: readonly QuotaApiKeyEntry[],
  right: readonly QuotaApiKeyEntry[]
): boolean =>
  JSON.stringify(left.map(serializeQuotaApiKeyEntry)) ===
  JSON.stringify(right.map(serializeQuotaApiKeyEntry));

export const quotaApiKeysApi = {
  async list(): Promise<QuotaApiKeyEntry[]> {
    const data = await getConfigValue<unknown>(PATH, []);
    return Array.isArray(data)
      ? data.map(parseQuotaApiKeyEntry).filter((entry): entry is QuotaApiKeyEntry => entry !== null)
      : [];
  },

  /**
   * Replace the whole list. `assertConnection` comes from guardConfigConnection() captured
   * when the list was loaded, so a write never lands on a connection switched since then.
   * An empty list is written as `[]`: core needs `quota-api` to stay a mapping.
   */
  async replace(entries: readonly QuotaApiKeyEntry[], assertConnection: () => void) {
    assertConnection();
    await apiClient.put(PATH, entries.map(serializeQuotaApiKeyEntry));
  },
};
