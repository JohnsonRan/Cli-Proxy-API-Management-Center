import { describe, expect, test } from 'bun:test';
import type { AuthFileItem } from '@/types/authFile';
import { buildQuotaCredentialOptions } from '@/utils/quotaCredentials';

describe('quota credential options with Command Code', () => {
  test('offers Command Code logins, which core reports as OAuth', () => {
    const files = [
      {
        id: 'commandcode-a@b.c.json',
        name: 'commandcode-a@b.c.json',
        provider: 'commandcode',
        account_type: 'oauth',
      },
      // A config API key of the same provider is not probed by core.
      {
        id: 'commandcode:apikey:1',
        name: 'commandcode:apikey:1',
        provider: 'commandcode',
        account_type: 'api_key',
      },
    ] as AuthFileItem[];
    expect(
      buildQuotaCredentialOptions(files, []).map((option) => [option.id, option.provider])
    ).toEqual([['commandcode-a@b.c.json', 'commandcode']]);
  });
});
