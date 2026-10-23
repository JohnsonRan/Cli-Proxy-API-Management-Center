import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { apiKeysApi, authFilesApi } from '@/services/api';
import { apiKeyNameFingerprint, readApiKeyNames } from '@/features/config/apiKeyNames';
import { useAuthStore } from '@/stores';
import { clientKeyId } from '../logic';

export interface UsageLabels {
  /** Auth-file email or name for an auth index, else the masked source, else the raw index. */
  credential: (authIndex: string, source?: string) => string;
  /** The note name saved for a client key on the config page, matched by usage key id. */
  keyName: (apiKeyId: string) => string | null;
}

/**
 * Resolves the names shown elsewhere in the panel: auth-file identities and client key
 * notes. Both are best effort; a failed lookup falls back to masked identifiers.
 */
export function useUsageLabels(connected: boolean): UsageLabels {
  const { t } = useTranslation();
  const apiBase = useAuthStore((state) => state.apiBase);
  const [credentialNames, setCredentialNames] = useState<Map<string, string>>(new Map());
  const [keyNames, setKeyNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!connected) return;
    let active = true;
    authFilesApi
      .list()
      .then((data) => {
        if (!active) return;
        const names = new Map<string, string>();
        (data?.files || []).forEach((file) => {
          if (file.authIndex !== undefined && file.authIndex !== null) {
            names.set(String(file.authIndex), file.email || file.name);
          }
        });
        setCredentialNames(names);
      })
      .catch(() => undefined);
    apiKeysApi
      .list()
      .then((keys) => {
        if (!active) return;
        const notes = readApiKeyNames(apiBase);
        const names = new Map<string, string>();
        keys.forEach((key) => {
          const note = notes[apiKeyNameFingerprint(apiBase, key)];
          if (note) {
            names.set(clientKeyId(bytesToHex(sha256(new TextEncoder().encode(key)))), note);
          }
        });
        setKeyNames(names);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [apiBase, connected]);

  const credential = useCallback(
    (authIndex: string, source?: string) =>
      credentialNames.get(authIndex) || source || authIndex || t('usage_stats.none'),
    [credentialNames, t]
  );
  const keyName = useCallback((apiKeyId: string) => keyNames.get(apiKeyId) ?? null, [keyNames]);
  return { credential, keyName };
}
