/** Client access keys are a direct config list, not upstream provider groups. */
import { apiClient } from './client';
import { getConfigValue, guardConfigConnection } from './configValue';

const PATH = '/config/access/api-keys';

export interface ClientApiKeyItem {
  apiKey: string;
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
    return {
      apiKey,
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

  if (!hasModels && !hasExcluded) {
    return item.apiKey;
  }
  const obj: Record<string, unknown> = {
    'api-key': item.apiKey,
  };
  if (hasModels) {
    obj['models'] = models;
  }
  if (hasExcluded) {
    obj['excluded-models'] = excluded;
  }
  return obj;
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
};
