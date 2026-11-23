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
  /** Effective allow-list rules. Empty means every model is allowed unless excluded. */
  allowed: string[];
  /** Effective exclusion rules, applied on top of the allow-list (or of everything). */
  excluded: string[];
  /** Allow-list entries rendered as chips. */
  visibleAllowed: string[];
  /** Allow-list entries collapsed behind the "+N more" chip. */
  hiddenAllowedCount: number;
  /** True when any effective allow-list or exclusion rule applies. */
  restricted: boolean;
  /** True when the effective allow-list comes from global `access.models`. */
  inheritsGlobalAllowed: boolean;
  /** True when the effective exclusions come from global `access.excluded-models`. */
  inheritsGlobalExcluded: boolean;
  /** True when either effective rule list comes from global defaults. */
  inheritsGlobal: boolean;
}

/** Allow-list entries shown before the remaining ones collapse into a counter chip. */
export const DEFAULT_VISIBLE_MODEL_LIMIT = 3;

const cleanPatterns = (values: readonly string[] | undefined): string[] => {
  if (!values) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const rule = raw.trim();
    const key = rule.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(rule);
  }
  return out;
};

const readAllowedPatterns = (input: ApiKeyModelScopeInput | null | undefined): string[] => {
  if (!input) return [];
  const models = cleanPatterns(input.models);
  const allowedModels = cleanPatterns(input.allowedModels);
  if (models.length === 0) return allowedModels;
  if (allowedModels.length === 0) return models;
  return cleanPatterns([...models, ...allowedModels]);
};

const isScopeInput = (value: unknown): value is ApiKeyModelScopeInput =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function summarizeApiKeyModelScope(
  item: ApiKeyModelScopeInput | null | undefined,
  visibleLimit: number = DEFAULT_VISIBLE_MODEL_LIMIT,
  globalRules?: ApiKeyModelScopeInput | null
): ApiKeyModelScopeSummary {
  const keyAllowed = readAllowedPatterns(item);
  const keyExcluded = cleanPatterns(item?.excludedModels);
  const globalInput = isScopeInput(globalRules) ? globalRules : null;
  const globalAllowed = readAllowedPatterns(globalInput);
  const globalExcluded = cleanPatterns(globalInput?.excludedModels);

  let allowed: string[];
  let excluded: string[];
  let inheritsGlobalAllowed = false;
  let inheritsGlobalExcluded = false;

  if (keyAllowed.length > 0) {
    // Per-key explicit allowed models take full precedence over global defaults.
    allowed = keyAllowed;
    excluded = keyExcluded;
  } else {
    allowed = globalAllowed;
    inheritsGlobalAllowed = globalAllowed.length > 0;
    if (keyExcluded.length > 0) {
      excluded = keyExcluded;
    } else {
      excluded = globalExcluded;
      inheritsGlobalExcluded = globalExcluded.length > 0;
    }
  }

  const limit = Math.max(Math.trunc(visibleLimit), 0);
  const restricted = allowed.length > 0 || excluded.length > 0;
  const inheritsGlobal = inheritsGlobalAllowed || inheritsGlobalExcluded;

  return {
    allowed,
    excluded,
    visibleAllowed: allowed.slice(0, limit),
    hiddenAllowedCount: Math.max(allowed.length - limit, 0),
    restricted,
    inheritsGlobalAllowed,
    inheritsGlobalExcluded,
    inheritsGlobal,
  };
}

/** True when the key narrows its effective model scope either by allow-list or by exclusions. */
export function hasApiKeyModelRestrictions(
  item: ApiKeyModelScopeInput | null | undefined,
  globalRules?: ApiKeyModelScopeInput | null
): boolean {
  return summarizeApiKeyModelScope(item, 0, globalRules).restricted;
}
