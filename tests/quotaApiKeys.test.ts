import { describe, expect, test } from 'bun:test';
import { buildQuotaCredentialOptions } from '@/utils/quotaCredentials';
import {
  parseQuotaApiKeyEntry,
  quotaCredentialsForKey,
  sameQuotaApiKeys,
  serializeQuotaApiKeyEntry,
  withQuotaCredentials,
  type QuotaApiKeyEntry,
} from '@/services/api/quotaApiKeys';
import type { AuthFileItem } from '@/types/authFile';

const entries: QuotaApiKeyEntry[] = [
  { apiKey: 'sk-a', credentials: ['codex.json'] },
  { apiKey: 'sk-b', credentials: ['claude.json'] },
];

describe('observability.quota-api.keys', () => {
  test('parses, trims and dedupes entries and drops ones without a key', () => {
    expect(
      parseQuotaApiKeyEntry({ 'api-key': ' sk-a ', credentials: [' a.json', 'a.json', '', 2] })
    ).toEqual({ apiKey: 'sk-a', credentials: ['a.json', '2'] });
    expect(parseQuotaApiKeyEntry({ credentials: ['a.json'] })).toBeNull();
    expect(parseQuotaApiKeyEntry('sk-a')).toBeNull();
    expect(
      serializeQuotaApiKeyEntry({ apiKey: ' sk-a', credentials: ['a.json', ' a.json'] })
    ).toEqual({ 'api-key': 'sk-a', credentials: ['a.json'] });
  });

  test('merges repeated keys like core does', () => {
    const repeated = [...entries, { apiKey: 'sk-a', credentials: ['xai.json', 'codex.json'] }];
    expect(quotaCredentialsForKey(repeated, ' sk-a ')).toEqual(['codex.json', 'xai.json']);
    expect(quotaCredentialsForKey(repeated, 'sk-c')).toEqual([]);
  });

  test('an unchanged save keeps the list identical', () => {
    const next = withQuotaCredentials(entries, 'sk-a', 'sk-a', ['codex.json']);
    expect(next).toEqual(entries);
    expect(sameQuotaApiKeys(entries, next)).toBe(true);
  });

  test('a renamed key carries its selection and the old value keeps nothing', () => {
    expect(withQuotaCredentials(entries, 'sk-a', 'sk-a2', ['codex.json', 'xai.json'])).toEqual([
      { apiKey: 'sk-a2', credentials: ['codex.json', 'xai.json'] },
      { apiKey: 'sk-b', credentials: ['claude.json'] },
    ]);
  });

  test('clearing the selection or deleting the key removes the entry', () => {
    expect(withQuotaCredentials(entries, 'sk-b', 'sk-b', [])).toEqual([entries[0]]);
    expect(withQuotaCredentials(entries, null, 'sk-new', [])).toEqual(entries);
    expect(withQuotaCredentials(entries, null, 'sk-new', ['a.json'])).toEqual([
      ...entries,
      { apiKey: 'sk-new', credentials: ['a.json'] },
    ]);
  });
});

describe('quota credential options', () => {
  const files = [
    { id: 'codex-b.json', name: 'codex-b.json', provider: 'codex', note: 'work' },
    { id: 'claude-a.json', name: 'claude-a.json', type: 'claude', disabled: true },
    { id: 'gemini.json', name: 'gemini.json', provider: 'gemini' },
    { name: 'grok.json', provider: 'Grok' },
  ] as AuthFileItem[];

  test('lists supported providers by core ID and keeps saved IDs that vanished', () => {
    const options = buildQuotaCredentialOptions(files, ['gone.json', 'codex-b.json']);
    expect(options.map((option) => [option.id, option.label, option.provider])).toEqual([
      ['claude-a.json', 'claude-a.json', 'claude'],
      ['codex-b.json', 'work · codex-b.json', 'codex'],
      ['grok.json', 'grok.json', 'grok'],
      ['gone.json', 'gone.json', ''],
    ]);
    expect(options[0].disabled).toBe(true);
    expect(options[3].missing).toBe(true);
  });
});
