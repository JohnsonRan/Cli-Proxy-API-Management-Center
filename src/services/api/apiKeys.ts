/** Client access keys are a direct config list, not upstream provider groups. */
import { apiClient } from './client';
import { getConfigValue, guardConfigConnection, isMissingConfigValue } from './configValue';

const PATH = '/config/access/api-keys';
const GLOBAL_MODELS_PATH = '/config/access/models';
const GLOBAL_EXCLUDED_MODELS_PATH = '/config/access/excluded-models';

export interface GlobalClientModelRules {
  models: string[];
  excludedModels: string[];
}

export interface ClientApiKeyItem {
  apiKey: string;
  /** Display name stored in the server config; it does not affect access. */
  name?: string;
  models?: string[];
  allowedModels?: string[];
  excludedModels?: string[];
}

export const parseClientApiKeyItem = (raw: unknown): ClientApiKeyItem => {
  if (typeof raw === 'string') {
    return { apiKey: raw.trim() };
  }
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    const apiKey = String(record['api-key'] ?? record['key'] ?? '').trim();
    const parseList = (val: unknown): string[] | undefined => {
      if (!Array.isArray(val)) return undefined;
      const list = val.map((x) => String(x).trim()).filter(Boolean);
      return list.length > 0 ? list : undefined;
    };
    const name = typeof record['name'] === 'string' ? record['name'].trim() : '';
    return {
      apiKey,
      name: name || undefined,
      models: parseList(record['models']),
      allowedModels: parseList(record['allowed-models']),
      excludedModels: parseList(record['excluded-models']),
    };
  }
  return { apiKey: String(raw ?? '').trim() };
};

export const serializeClientApiKeyItem = (item: ClientApiKeyItem): unknown => {
  const models = (item.models ?? item.allowedModels)?.map((s) => s.trim()).filter(Boolean);
  const excluded = item.excludedModels?.map((s) => s.trim()).filter(Boolean);
  const hasModels = Boolean(models && models.length > 0);
  const hasExcluded = Boolean(excluded && excluded.length > 0);
  const name = item.name?.trim();

  if (!name && !hasModels && !hasExcluded) {
    return item.apiKey;
  }
  const obj: Record<string, unknown> = {
    'api-key': item.apiKey,
  };
  if (name) {
    obj['name'] = name;
  }
  if (hasModels) {
    obj['models'] = models;
  }
  if (hasExcluded) {
    obj['excluded-models'] = excluded;
  }
  return obj;
};

export const normalizeClientModelPatterns = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const rule = item.trim();
    const key = rule.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(rule);
  }
  return out;
};

export const serializeClientModelPatterns = (
  patterns: readonly string[] | undefined
): string[] | undefined => {
  const normalized = normalizeClientModelPatterns(patterns);
  return normalized.length > 0 ? normalized : undefined;
};

export const parseGlobalClientModelRules = (
  rawModels: unknown,
  rawExcludedModels: unknown
): GlobalClientModelRules => ({
  models: normalizeClientModelPatterns(rawModels),
  excludedModels: normalizeClientModelPatterns(rawExcludedModels),
});

const writeModelPatternList = async (
  path: string,
  next: string[] | undefined,
  previous: string[] | undefined,
  hasPrevious: boolean,
  assertConnection: () => void
): Promise<void> => {
  if (hasPrevious && JSON.stringify(next ?? []) === JSON.stringify(previous ?? [])) {
    return;
  }
  assertConnection();
  if (!next) {
    try {
      await apiClient.delete(path);
    } catch (error) {
      if (!isMissingConfigValue(error)) throw error;
    }
  } else {
    await apiClient.put(path, next);
  }
  assertConnection();
};

const assertIndex = (length: number, index: number): void => {
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new RangeError('API key index out of range');
  }
};

export const apiKeysApi = {
  async list(): Promise<string[]> {
    const items = await apiKeysApi.listItems();
    return items.map((item) => item.apiKey);
  },

  async listItems(): Promise<ClientApiKeyItem[]> {
    const data = await getConfigValue<unknown>(PATH, []);
    return Array.isArray(data) ? data.map(parseClientApiKeyItem) : [];
  },

  replace: (keys: string[]) => apiClient.put(PATH, keys),

  replaceItems: (items: ClientApiKeyItem[]) =>
    apiClient.put(PATH, items.map(serializeClientApiKeyItem)),

  async update(index: number, value: string) {
    const assertConnection = guardConfigConnection();
    const items = await apiKeysApi.listItems();
    assertConnection();
    assertIndex(items.length, index);
    items[index] = { ...items[index], apiKey: value };
    return apiKeysApi.replaceItems(items);
  },

  async updateItem(index: number, value: ClientApiKeyItem) {
    const assertConnection = guardConfigConnection();
    const items = await apiKeysApi.listItems();
    assertConnection();
    assertIndex(items.length, index);
    items[index] = value;
    return apiKeysApi.replaceItems(items);
  },

  async delete(index: number) {
    const assertConnection = guardConfigConnection();
    const items = await apiKeysApi.listItems();
    assertConnection();
    assertIndex(items.length, index);
    items.splice(index, 1);
    return apiKeysApi.replaceItems(items);
  },

  async getGlobalModelRules(): Promise<GlobalClientModelRules> {
    const [models, excludedModels] = await Promise.all([
      getConfigValue<unknown>(GLOBAL_MODELS_PATH, []),
      getConfigValue<unknown>(GLOBAL_EXCLUDED_MODELS_PATH, []),
    ]);
    return parseGlobalClientModelRules(models, excludedModels);
  },

  async replaceGlobalModelRules(
    rules: GlobalClientModelRules,
    previous?: GlobalClientModelRules,
    assertConnection: () => void = () => {},
    onModelsSaved?: (models: string[]) => void
  ): Promise<GlobalClientModelRules> {
    const nextModels = serializeClientModelPatterns(rules.models);
    const nextExcluded = serializeClientModelPatterns(rules.excludedModels);
    const hasPrevious = previous !== undefined;
    const prevModels = previous ? serializeClientModelPatterns(previous.models) : undefined;
    const prevExcluded = previous
      ? serializeClientModelPatterns(previous.excludedModels)
      : undefined;

    await writeModelPatternList(
      GLOBAL_MODELS_PATH,
      nextModels,
      prevModels,
      hasPrevious,
      assertConnection
    );
    onModelsSaved?.(nextModels ?? []);

    await writeModelPatternList(
      GLOBAL_EXCLUDED_MODELS_PATH,
      nextExcluded,
      prevExcluded,
      hasPrevious,
      assertConnection
    );

    return {
      models: nextModels ?? [],
      excludedModels: nextExcluded ?? [],
    };
  },
};
