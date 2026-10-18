import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import type { UpstreamQuotaEntry, UpstreamQuotaState } from '../hooks/useUpstreamQuotas';
import { UpstreamQuotaCard } from './UpstreamQuotaCard';
import styles from './UpstreamQuotaSection.module.scss';

export interface UpstreamQuotaSectionProps {
  entries: UpstreamQuotaEntry[];
  states: Record<string, UpstreamQuotaState>;
  resolvedTheme: ResolvedTheme;
  canRefresh: boolean;
  onRefresh: (entry: UpstreamQuotaEntry) => void;
}

/**
 * The quota other proxies share with this proxy's provider keys, next to the OAuth
 * credentials. Lists every key with a custom base URL; nothing is requested until the
 * user asks, so an unrelated custom endpoint is never probed on page load.
 */
export function UpstreamQuotaSection({
  entries,
  states,
  resolvedTheme,
  canRefresh,
  onRefresh,
}: UpstreamQuotaSectionProps) {
  const { t } = useTranslation();
  if (entries.length === 0) return null;

  return (
    <section className={styles.section} aria-labelledby="upstream-quota-title">
      <header className={styles.head}>
        <h2 id="upstream-quota-title" className={styles.title}>
          {t('quota_management.upstream_title')}
        </h2>
        <p className={styles.description}>{t('quota_management.upstream_desc')}</p>
      </header>
      <div className={styles.grid}>
        {entries.map((entry) => (
          <UpstreamQuotaCard
            key={entry.key}
            entry={entry}
            state={states[entry.key]}
            resolvedTheme={resolvedTheme}
            canRefresh={canRefresh}
            onRefresh={() => onRefresh(entry)}
          />
        ))}
      </div>
    </section>
  );
}
