import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collectUpstreamQuotaProviders,
  fetchUpstreamQuota,
  type UpstreamQuotaResult,
  type UpstreamQuotaTarget,
} from '@/features/providers/upstreamQuota';
import type { ProviderResource } from '@/features/providers/types';
import { buildProviderGroups } from '@/features/providers/useProviderWorkbench';
import { useAuthStore, useConfigStore } from '@/stores';
import type { Config } from '@/types';
import { getErrorMessage } from '@/utils/helpers';

export interface UpstreamQuotaEntry {
  /** The auth index: unique per provider key within one connection. */
  key: string;
  resource: ProviderResource;
  target: UpstreamQuotaTarget;
}

export interface UpstreamQuotaState {
  loading: boolean;
  result: UpstreamQuotaResult | null;
}

/** One entry per provider key that may reach an upstream proxy, in provider-list order. */
export const buildUpstreamQuotaEntries = (config: Config | null): UpstreamQuotaEntry[] =>
  config
    ? collectUpstreamQuotaProviders(buildProviderGroups(config)).flatMap(({ resource, targets }) =>
        targets.map((target) => ({ key: target.authIndex, resource, target }))
      )
    : [];

/**
 * Provider keys that may reach an upstream proxy, and their quota once checked. Lives on
 * the quota page so the cards and the timeline read the same results. Nothing is
 * requested until `load` is called.
 */
export function useUpstreamQuotas() {
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const apiBase = useAuthStore((state) => state.apiBase);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);

  useEffect(() => {
    if (connected) fetchConfig().catch(() => {});
  }, [connected, fetchConfig]);

  const entries = useMemo(
    () => (connected ? buildUpstreamQuotaEntries(config) : []),
    [connected, config]
  );

  // Results belong to one connection: a new server may reuse an auth index.
  const [store, setStore] = useState<{
    owner: string;
    states: Record<string, UpstreamQuotaState>;
  }>({ owner: apiBase, states: {} });
  const states = store.owner === apiBase ? store.states : {};
  const ownerRef = useRef(apiBase);
  useEffect(() => {
    ownerRef.current = apiBase;
  }, [apiBase]);

  const load = useCallback(
    async (entry: UpstreamQuotaEntry) => {
      const owner = apiBase;
      const update = (next: (prev: UpstreamQuotaState | undefined) => UpstreamQuotaState) =>
        setStore((prev) => {
          const base = prev.owner === owner ? prev.states : {};
          return { owner, states: { ...base, [entry.key]: next(base[entry.key]) } };
        });
      // Keep the previous result visible while refreshing, as the OAuth cards do.
      update((prev) => ({ loading: true, result: prev?.result ?? null }));
      let result: UpstreamQuotaResult;
      try {
        result = await fetchUpstreamQuota(entry.target.authIndex, entry.target.baseUrl);
      } catch (err) {
        result = { ok: false, reason: 'error', message: getErrorMessage(err, '') };
      }
      // A response that arrives after a connection switch must not land on the new one.
      if (ownerRef.current !== owner) return;
      update(() => ({ loading: false, result }));
    },
    [apiBase]
  );

  return { entries, states, load };
}
