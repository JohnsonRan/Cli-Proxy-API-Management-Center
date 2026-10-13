import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import { modelsApi } from '../src/services/api/models';

const spies: Array<{ mockRestore(): void }> = [];
const mockGet = (value: unknown) => {
  const spy = spyOn(apiClient, 'get').mockResolvedValue(value as never);
  spies.push(spy);
  return spy;
};
afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

describe('management model catalog', () => {
  it('reads the management model list and keeps display names', async () => {
    const get = mockGet({
      models: [
        { id: 'gpt-5', display_name: ' GPT-5 ' },
        { id: 'claude-4' },
      ],
    });

    expect(await modelsApi.listCatalog()).toEqual([
      { id: 'claude-4', display_name: undefined },
      { id: 'gpt-5', display_name: 'GPT-5' },
    ]);
    expect(get).toHaveBeenCalledWith('/models');
  });

  it('trims ids, drops blanks, and dedupes case-insensitively keeping the first spelling', async () => {
    mockGet({
      models: [
        { id: ' gpt-5 ' },
        { id: 'GPT-5' },
        { id: '   ' },
        {},
        { id: 'claude-4' },
        { id: 'CLAUDE-4' },
      ],
    });

    expect(await modelsApi.listCatalog()).toEqual([
      { id: 'claude-4', display_name: undefined },
      { id: 'gpt-5', display_name: undefined },
    ]);
  });

  it('returns an empty list when the payload has no models', async () => {
    mockGet({});
    expect(await modelsApi.listCatalog()).toEqual([]);
  });
});
