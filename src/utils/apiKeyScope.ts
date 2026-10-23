/**
 * Pure helpers for rendering a client key's model scope in the API keys page.
 * Kept free of API types so both the page and tests can use them directly.
 */

export interface ApiKeyModelScopeInput {
  models?: readonly string[];
  allowedModels?: readonly string[];
  excludedModels?: readonly string[];
}

export interface ApiKeyModelScopeSummary {
  /** Allow-list rules. Empty means every model is allowed. */
  allowed: string[];
  /** Exclusion rules, applied on top of the allow-list (or of everything). */
  excluded: string[];
  /** Allow-list entries rendered as chips. */
  visibleAllowed: string[];
  /** Allow-list entries collapsed behind the "+N more" chip. */
  hiddenAllowedCount: number;
}

/** Allow-list entries shown before the remaining ones collapse into a counter chip. */
export const DEFAULT_VISIBLE_MODEL_LIMIT = 3;

export function summarizeApiKeyModelScope(
  item: ApiKeyModelScopeInput | null | undefined,
  visibleLimit: number = DEFAULT_VISIBLE_MODEL_LIMIT
): ApiKeyModelScopeSummary {
  const allowed = [...(item?.models ?? item?.allowedModels ?? [])].filter(Boolean);
  const excluded = [...(item?.excludedModels ?? [])].filter(Boolean);
  const limit = Math.max(Math.trunc(visibleLimit), 0);
  return {
    allowed,
    excluded,
    visibleAllowed: allowed.slice(0, limit),
    hiddenAllowedCount: Math.max(allowed.length - limit, 0),
  };
}

/** True when the key narrows its model scope either by allow-list or by exclusions. */
export function hasApiKeyModelRestrictions(
  item: ApiKeyModelScopeInput | null | undefined
): boolean {
  const { allowed, excluded } = summarizeApiKeyModelScope(item, 0);
  return allowed.length > 0 || excluded.length > 0;
}
