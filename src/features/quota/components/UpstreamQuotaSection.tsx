import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { UpstreamQuotaPanel } from '@/features/providers/sheets/UpstreamQuotaPanel';
import { collectUpstreamQuotaProviders } from '@/features/providers/upstreamQuota';
import { buildProviderGroups } from '@/features/providers/useProviderWorkbench';
import { useAuthStore, useConfigStore } from '@/stores';
import type { Config } from '@/types';
import styles from './UpstreamQuotaSection.module.scss';

interface UpstreamQuotaSectionViewProps {
  config: Config | null;
  /** Scopes panel state to one connection: a new server may reuse an auth index. */
  connectionKey: string;
}

/**
 * The quota other proxies share with this proxy's provider keys, next to the OAuth
 * credentials. Lists every key with a custom base URL; nothing is requested until the
 * user asks, so an unrelated custom endpoint is never probed on page load.
 */
export function UpstreamQuotaSectionView({ config, connectionKey }: UpstreamQuotaSectionViewProps) {
  const { t } = useTranslation();
  const providers = useMemo(
    () => (config ? collectUpstreamQuotaProviders(buildProviderGroups(config)) : []),
    [config]
  );

  if (providers.length === 0) return null;

  return (
    <section className={styles.section} aria-labelledby="upstream-quota-title">
      <header className={styles.head}>
        <h2 id="upstream-quota-title" className={styles.title}>
          {t('quota_management.upstream_title')}
        </h2>
        <p className={styles.description}>{t('quota_management.upstream_desc')}</p>
      </header>
      <div className={styles.grid}>
        {providers.flatMap(({ resource, targets }) =>
          targets.map((target) => (
            <UpstreamQuotaPanel
              key={`${connectionKey}|${target.authIndex}`}
              className={styles.card}
              authIndex={target.authIndex}
              baseUrl={target.baseUrl}
              title={[
                t(`providersPage.providerNames.${resource.brand}`),
                resource.name,
                target.maskedKey,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))
        )}
      </div>
    </section>
  );
}

export function UpstreamQuotaSection() {
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const apiBase = useAuthStore((state) => state.apiBase);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);

  useEffect(() => {
    if (connected) fetchConfig().catch(() => {});
  }, [connected, fetchConfig]);

  if (!connected) return null;
  return <UpstreamQuotaSectionView config={config} connectionKey={apiBase} />;
}
