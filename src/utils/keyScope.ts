/**
 * Pure mirror of the backend's client.key-scopes matching (internal/config/key_scopes.go):
 * the longest key-prefix the key starts with wins, and an entry without a prefix or
 * without providers is skipped rather than locking keys out.
 */
import type { ClientKeyScope } from '@/services/api/keyScopes';

/** Names that resolve to another provider key on the backend. */
export const KEY_SCOPE_PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  anthropic: 'claude',
  openai: 'codex',
  chatgpt: 'codex',
  muse: 'meta',
  grok: 'xai',
};

/** Built-in provider keys offered as suggestions; any other name is still accepted. */
export const KEY_SCOPE_BUILTIN_PROVIDERS = [
  'claude',
  'codex',
  'gemini',
  'gemini-interactions',
  'vertex',
  'aistudio',
  'antigravity',
  'xai',
  'meta',
  'kimi',
  'devin',
] as const;

export const normalizeKeyScopeProvider = (provider: string): string => {
  const name = provider.trim().toLowerCase();
  return KEY_SCOPE_PROVIDER_ALIASES[name] ?? name;
};

/** Providers as core resolves them (aliases applied, deduplicated), for display. */
export const effectiveKeyScopeProviders = (providers: readonly string[]): string[] => [
  ...new Set(providers.map(normalizeKeyScopeProvider).filter(Boolean)),
];

const usable = (scope: ClientKeyScope) =>
  scope.keyPrefix.trim() !== '' &&
  scope.providers.some((provider) => normalizeKeyScopeProvider(provider) !== '');

export interface ResolvedKeyScope {
  index: number;
  scope: ClientKeyScope;
}

export function resolveKeyScope(
  apiKey: string,
  scopes: readonly ClientKeyScope[]
): ResolvedKeyScope | null {
  const key = apiKey.trim();
  if (!key) return null;
  let best: ResolvedKeyScope | null = null;
  scopes.forEach((scope, index) => {
    const prefix = scope.keyPrefix.trim();
    if (!usable(scope) || !key.startsWith(prefix)) return;
    // Strictly longer only: the first of two equal prefixes wins, as on the backend.
    if (!best || prefix.length > best.scope.keyPrefix.trim().length) best = { index, scope };
  });
  return best;
}

export type KeyScopeRuleError = 'prefix_required' | 'providers_required' | 'prefix_duplicate';

/** Per-row problems that would make the backend ignore or shadow a rule. */
export function validateKeyScopes(
  scopes: readonly ClientKeyScope[]
): Array<KeyScopeRuleError | undefined> {
  const seen = new Set<string>();
  return scopes.map((scope) => {
    const prefix = scope.keyPrefix.trim();
    if (!prefix) return 'prefix_required';
    if (!scope.providers.some((provider) => provider.trim())) return 'providers_required';
    if (seen.has(prefix)) return 'prefix_duplicate';
    seen.add(prefix);
    return undefined;
  });
}

/**
 * A datalist pick fires a plain Event or an InputEvent of type insertReplacementText;
 * typing fires InputEvents such as insertText. Duck-typed so it also runs outside browsers.
 */
export const isOptionPick = (event: Event): boolean => {
  const inputType = (event as Partial<Pick<InputEvent, 'inputType'>>).inputType;
  return inputType === undefined || inputType === 'insertReplacementText';
};
