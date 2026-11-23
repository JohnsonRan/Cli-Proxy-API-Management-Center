import { isQuotaApiProvider } from '@/services/api/quotaApiKeys';
import type { AuthFileItem } from '@/types/authFile';
import type { Config } from '@/types';
import { QUOTA_RELAY_PROVIDER } from '@/utils/constants';
import { maskApiKey } from '@/utils/format';

export interface QuotaCredentialOption {
  /** Core auth ID, the value stored in quota-api.keys. */
  id: string;
  label: string;
  provider: string;
  disabled: boolean;
  /** Selected but no longer among the credentials. */
  missing: boolean;
  /**
   * A relay using one of this proxy's own client keys: likely this proxy itself, which core
   * reports as a relay loop. Another proxy may share the key, so it stays selectable.
   */
  ownKey?: boolean;
}

/**
 * Options for the credentials whose quota core's GET /v1/usage can read. Core probes only
 * OAuth credentials (`account_type` is core's AuthKind), so API-key credentials of the same
 * providers are left out. Saved IDs that no longer match a credential keep a row so they can
 * be cleared instead of lingering.
 */
export const buildQuotaCredentialOptions = (
  files: readonly AuthFileItem[],
  selected: readonly string[],
  relays: readonly QuotaCredentialOption[] = []
): QuotaCredentialOption[] => {
  const byId = new Map<string, QuotaCredentialOption>();
  relays.forEach((relay) => {
    if (!byId.has(relay.id)) byId.set(relay.id, relay);
  });
  files.forEach((file) => {
    const provider = String(file.provider ?? file.type ?? '')
      .trim()
      .toLowerCase();
    if (!isQuotaApiProvider(provider) || file['account_type'] !== 'oauth') return;
    const id = String(file['id'] ?? file.name ?? '').trim();
    if (!id || byId.has(id)) return;
    const name = String(file.name ?? id).trim() || id;
    const note = typeof file.note === 'string' ? file.note.trim() : '';
    byId.set(id, {
      id,
      label: note ? `${note} · ${name}` : name,
      provider,
      disabled: file.disabled === true,
      missing: false,
    });
  });
  selected.forEach((id) => {
    if (!byId.has(id))
      byId.set(id, { id, label: id, provider: '', disabled: false, missing: true });
  });
  // OAuth credentials first, then relays, then removed IDs; alphabetical within each group.
  const rank = (option: QuotaCredentialOption) =>
    option.missing ? 2 : option.provider === QUOTA_RELAY_PROVIDER ? 1 : 0;
  return [...byId.values()].sort(
    (left, right) =>
      rank(left) - rank(right) ||
      left.provider.localeCompare(right.provider) ||
      left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
  );
};

/** Options whose label, provider or stored ID contains the query, case-insensitively. */
export const filterQuotaCredentialOptions = (
  options: readonly QuotaCredentialOption[],
  query: string
): readonly QuotaCredentialOption[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return options;
  return options.filter((option) =>
    [option.label, option.provider, option.id].some((text) => text.toLowerCase().includes(needle))
  );
};

type RelayKey = { apiKey?: string; baseUrl?: string; authIndex?: string };

/**
 * Provider API keys with a custom base URL, which may point at another proxy whose own
 * GET /v1/usage core relays. They are stored by auth index, the only identifier config-based
 * credentials expose; editing the key or base URL changes it, and the old selection then
 * shows as removed.
 */
export const buildQuotaRelayOptions = (
  config: Config | null | undefined
): QuotaCredentialOption[] => {
  if (!config) return [];
  const ownKeys = new Set((config.apiKeys ?? []).map((key) => key.trim()).filter(Boolean));
  const options: QuotaCredentialOption[] = [];
  const add = (key: RelayKey, name: string) => {
    const id = String(key.authIndex ?? '').trim();
    if (!id || !String(key.baseUrl ?? '').trim()) return;
    const masked = key.apiKey ? maskApiKey(key.apiKey) : id;
    options.push({
      id,
      label: `${name} · ${masked} · ${key.baseUrl}`,
      provider: QUOTA_RELAY_PROVIDER,
      disabled: false,
      missing: false,
      ownKey: ownKeys.has(String(key.apiKey ?? '').trim()),
    });
  };
  (config.openaiCompatibility ?? []).forEach((provider) => {
    if (provider.disabled) return;
    provider.apiKeyEntries.forEach((entry) =>
      add({ ...entry, baseUrl: provider.baseUrl }, provider.name || 'openai-compatibility')
    );
  });
  const groups: Array<[string, readonly RelayKey[] | undefined]> = [
    ['codex', config.codexApiKeys],
    ['claude', config.claudeApiKeys],
    ['gemini', config.geminiApiKeys],
  ];
  groups.forEach(([name, keys]) => (keys ?? []).forEach((key) => add(key, name)));
  return options;
};

export interface QuotaCredentialsLoadResult {
  state: 'ready' | 'error';
  files: AuthFileItem[];
}

/**
 * Loads the auth-files list and refreshes config for relay options. A config fetch failure
 * must not block OAuth credentials visibility; only an auth-files failure is fatal.
 */
export async function loadQuotaCredentialsSources(
  fetchFiles: () => Promise<{ files?: AuthFileItem[] }>,
  fetchCfg: () => Promise<unknown>
): Promise<QuotaCredentialsLoadResult> {
  const [filesResult] = await Promise.allSettled([fetchFiles(), fetchCfg()]);
  if (filesResult.status !== 'fulfilled') {
    return { state: 'error', files: [] };
  }
  return { state: 'ready', files: filesResult.value.files ?? [] };
}
