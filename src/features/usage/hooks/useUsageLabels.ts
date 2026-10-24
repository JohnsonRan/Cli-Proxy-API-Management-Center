import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { authFilesApi } from '@/services/api';
import { getConfigValue } from '@/services/api/configValue';
import { apiKeyNameFingerprint, readApiKeyNames } from '@/features/config/apiKeyNames';
import type { QuotaFileEntry } from '@/features/quota/logic';
import { useAuthStore, useQuotaStore } from '@/stores';
import { normalizeRecentRequestAuthIndex } from '@/utils/recentRequests';
import { clientKeyEntries, clientKeyId } from '../logic';
import { indexQuotaEntriesByAuthIndex } from '../quota';

export interface UsageLabels {
  /** Auth-file email or name for an auth index, else the masked source, else the raw index. */
  credential: (authIndex: string, source?: string) => string;
  /** The client key's name from the config (`access.api-keys[].name`) or its local note. */
  keyName: (apiKeyId: string) => string | null;
  /** Quota-capable auth file and provider adapter type for an auth index, if any. */
  quotaEntry?: (authIndex: string) => QuotaFileEntry | null;
}

/**
 * Resolves the names shown elsewhere in the panel: auth-file identities and client key
 * names, plus quota-capable auth files keyed by `auth_index` from the same list request.
 */
export function useUsageLabels(connected: boolean): UsageLabels {
  const { t } = useTranslation();
  const apiBase = useAuthStore((state) => state.apiBase);
  const cacheGeneration = useQuotaStore((state) => state.cacheGeneration);
  const [credentialNames, setCredentialNames] = useState<Map<string, string>>(new Map());
  const [quotaEntries, setQuotaEntries] = useState<Map<string, QuotaFileEntry>>(new Map());
  const [keyNames, setKeyNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!connected) {
      setCredentialNames(new Map());
      setQuotaEntries(new Map());
      setKeyNames(new Map());
      return;
    }
    let active = true;
    authFilesApi
      .list()
      .then((data) => {
        if (!active || cacheGeneration !== useQuotaStore.getState().cacheGeneration) return;
        const files = data?.files || [];
        const names = new Map<string, string>();
        files.forEach((file) => {
          const authIndex = normalizeRecentRequestAuthIndex(file['auth_index'] ?? file.authIndex);
          if (authIndex) {
            names.set(authIndex, file.email || file.name);
          }
        });
        setCredentialNames(names);
        setQuotaEntries(indexQuotaEntriesByAuthIndex(files));
      })
      .catch(() => undefined);
    getConfigValue<unknown>('/config/access/api-keys', [])
      .then((raw) => {
        if (!active) return;
        const notes = readApiKeyNames(apiBase);
        const names = new Map<string, string>();
        clientKeyEntries(raw).forEach(({ key, name }) => {
          // The config name wins; the browser-local note is the fallback for plain string keys.
          const label = name || notes[apiKeyNameFingerprint(apiBase, key)];
          if (label) {
            names.set(clientKeyId(bytesToHex(sha256(new TextEncoder().encode(key)))), label);
          }
        });
        setKeyNames(names);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [apiBase, cacheGeneration, connected]);

  const credential = useCallback(
    (authIndex: string, source?: string) =>
      credentialNames.get(normalizeRecentRequestAuthIndex(authIndex) ?? authIndex) ||
      source ||
      authIndex ||
      t('usage_stats.none'),
    [credentialNames, t]
  );
  const keyName = useCallback((apiKeyId: string) => keyNames.get(apiKeyId) ?? null, [keyNames]);
  const quotaEntry = useCallback(
    (authIndex: string) => {
      const normalized = normalizeRecentRequestAuthIndex(authIndex);
      return normalized ? (quotaEntries.get(normalized) ?? null) : null;
    },
    [quotaEntries]
  );
  return { credential, keyName, quotaEntry };
}
