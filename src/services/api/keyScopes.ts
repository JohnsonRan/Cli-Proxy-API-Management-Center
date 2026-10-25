/** Provider scopes for client API keys: the `client.key-scopes` config list. */
import { apiClient } from './client';
import { getConfigValue, isMissingConfigValue } from './configValue';

const PATH = '/config/client/key-scopes';

export interface ClientKeyScope {
  keyPrefix: string;
  providers: string[];
}

export const parseClientKeyScope = (raw: unknown): ClientKeyScope | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const providers = Array.isArray(record.providers)
    ? record.providers.map((provider) => String(provider ?? '').trim()).filter(Boolean)
    : [];
  return { keyPrefix: String(record['key-prefix'] ?? '').trim(), providers };
};

export const serializeClientKeyScope = (scope: ClientKeyScope) => ({
  'key-prefix': scope.keyPrefix.trim(),
  providers: scope.providers.map((provider) => provider.trim()).filter(Boolean),
});

export const keyScopesApi = {
  async list(): Promise<ClientKeyScope[]> {
    const data = await getConfigValue<unknown>(PATH, []);
    return Array.isArray(data)
      ? data.map(parseClientKeyScope).filter((scope): scope is ClientKeyScope => scope !== null)
      : [];
  },

  /**
   * Replace the whole list. `assertConnection` comes from guardConfigConnection() captured
   * when the list was loaded, so a write never lands on a connection switched since then.
   * An empty list removes the key so config.yaml does not keep `key-scopes: []`.
   */
  async replace(scopes: ClientKeyScope[], previouslyEmpty: boolean, assertConnection: () => void) {
    assertConnection();
    if (scopes.length === 0) {
      if (previouslyEmpty) return;
      try {
        await apiClient.delete(PATH);
      } catch (error) {
        // Already gone (removed elsewhere) is the state we wanted.
        if (!isMissingConfigValue(error)) throw error;
      }
      return;
    }
    await apiClient.put(PATH, scopes.map(serializeClientKeyScope));
  },
};
