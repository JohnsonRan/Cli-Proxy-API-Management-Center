import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { formatPercent } from '../format';
import styles from '../UsagePage.module.scss';

/**
 * Summary card with an optional change against the previous period.
 * `goodWhenUp` colours the change: more requests is good, more latency is not.
 */
export function StatCard({
  label,
  value,
  sub,
  change,
  goodWhenUp = true,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  change?: number | null;
  goodWhenUp?: boolean;
}) {
  const { t } = useTranslation();
  const tone =
    change === undefined || change === null || Math.abs(change) < 0.05
      ? styles.changeFlat
      : change > 0 === goodWhenUp
        ? styles.changeGood
        : styles.changeBad;
  return (
    <div className={styles.statCard}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statSub}>
        {change !== undefined && change !== null && (
          <span
            className={tone}
            title={t('usage_stats.change_hint')}
            aria-label={t('usage_stats.change_label', {
              value: formatPercent(change),
            })}
          >
            {`${change > 0 ? '+' : ''}${formatPercent(change)}`}
          </span>
        )}
        {sub}
      </span>
    </div>
  );
}
