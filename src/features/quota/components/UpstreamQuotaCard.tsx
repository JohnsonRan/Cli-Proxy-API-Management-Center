/**
 * One provider key's upstream quota, in the same card shell as the OAuth credentials:
 * brand icon and name, a click-to-load idle body, then the shared accounts.
 */

import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { PROVIDER_LOGOS } from '@/features/providers/brandLogos';
import { UpstreamQuotaResultView } from '@/features/providers/sheets/UpstreamQuotaPanel';
import { getThemeSurfaceIconBackground } from '@/features/authFiles/constants';
import type { ResolvedTheme } from '@/types';
import type { UpstreamQuotaEntry, UpstreamQuotaState } from '../hooks/useUpstreamQuotas';
import styles from './QuotaCard.module.scss';

export interface UpstreamQuotaCardProps {
  entry: UpstreamQuotaEntry;
  state?: UpstreamQuotaState;
  resolvedTheme: ResolvedTheme;
  canRefresh: boolean;
  onRefresh: () => void;
}

export function UpstreamQuotaCard({
  entry,
  state,
  resolvedTheme,
  canRefresh,
  onRefresh,
}: UpstreamQuotaCardProps) {
  const { t } = useTranslation();
  const { resource, target } = entry;
  const brandLabel = t(`providersPage.providerNames.${resource.brand}`);
  const logo = PROVIDER_LOGOS[resource.brand];
  const iconSrc = logo ? (resolvedTheme === 'dark' && logo.darkSrc) || logo.src : null;
  const name = [resource.name ?? brandLabel, target.maskedKey].filter(Boolean).join(' · ');
  const loading = state?.loading === true;
  const result = state?.result ?? null;

  return (
    <article className={styles.card}>
      <header className={styles.head}>
        <span
          className={styles.iconWrap}
          title={brandLabel}
          style={
            logo?.themeSurface
              ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
              : undefined
          }
        >
          {iconSrc ? (
            <img src={iconSrc} alt="" className={styles.icon} />
          ) : (
            <span className={styles.iconFallback}>{brandLabel.slice(0, 1).toUpperCase()}</span>
          )}
        </span>
        <span className={styles.fileName} title={`${name}\n${target.baseUrl}`}>
          {name}
        </span>
      </header>

      <div className={styles.body}>
        {!state ? (
          <button
            type="button"
            className={styles.idleBody}
            onClick={onRefresh}
            disabled={!canRefresh}
          >
            <IconRefreshCw size={15} aria-hidden="true" className={styles.idleGlyph} />
            <span className={styles.idleHint}>{t('quota_management.upstream_idle')}</span>
          </button>
        ) : loading && !result ? (
          <div className={styles.skeleton} aria-busy="true">
            <span className={styles.srOnly}>{t('quota_management.upstream_loading')}</span>
            {[0, 1].map((row) => (
              <div key={row} className={styles.skeletonRow} aria-hidden="true">
                <span className={styles.skeletonLabel} />
                <span className={styles.skeletonTrack} />
              </div>
            ))}
          </div>
        ) : result ? (
          <UpstreamQuotaResultView result={result} />
        ) : null}
      </div>

      {state && (
        <footer className={styles.actionRow}>
          <button
            type="button"
            className={styles.actionPill}
            onClick={onRefresh}
            disabled={!canRefresh || loading}
            title={t('providersPage.upstreamQuota.refresh')}
          >
            <IconRefreshCw size={13} className={loading ? styles.spinning : undefined} />
            {t('auth_files.quota_refresh_single')}
          </button>
        </footer>
      )}
    </article>
  );
}
