import { describe, expect, test } from 'bun:test';
import { normalizeConfigResponse } from '@/services/api/transformers';

describe('config auth index', () => {
  test('reads the auth_index the v8 config injects per key', () => {
    const config = normalizeConfigResponse({
      'api-keys': {
        'openai-compatibility': [
          {
            name: 'friend',
            'base-url': 'http://127.0.0.1:18400/v1',
            keys: [{ 'api-key': 'sk-friend', auth_index: '4bdcfda74ba4aced' }],
          },
        ],
        codex: [{ keys: [{ 'api-key': 'sk-codex', auth_index: 'codex-index' }] }],
        claude: [{ keys: [{ 'api-key': 'sk-claude', 'auth-index': 'legacy-index' }] }],
      },
    });
    expect(config.openaiCompatibility?.[0].apiKeyEntries[0].authIndex).toBe('4bdcfda74ba4aced');
    expect(config.codexApiKeys?.[0].authIndex).toBe('codex-index');
    expect(config.claudeApiKeys?.[0].authIndex).toBe('legacy-index');
  });
});
