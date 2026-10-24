import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { METRIC_ACCENTS, type MetricAccent } from '../charts';
import { formatPercent } from '../format';
import { MetricIcon } from './MetricIcon';
import { Sparkline } from './Sparkline';
import styles from '../UsagePage.module.scss';

/**
 * Headline metric card. The accent colours the icon, top edge, tint and sparkline so each
 * metric keeps one colour across the page. `goodWhenUp` colours the period change.
 */
export function StatCard({
  label,
  value,
  valueTitle,
  sub,
  change,
  changeUnit = '%',
  goodWhenUp = true,
  accent,
  spark,
}: {
  label: string;
  value: ReactNode;
  /** Hover text for the value, e.g. the exact number behind a compact one. */
  valueTitle?: string;
  sub?: ReactNode;
  change?: number | null;
  changeUnit?: '%' | 'pt';
  goodWhenUp?: boolean;
  accent: MetricAccent;
  spark?: number[];
}) {
  const { t } = useTranslation();
  const color = METRIC_ACCENTS[accent];
  const hasChange = change !== undefined && change !== null;
  const tone =
    !hasChange || Math.abs(change) < 0.05
      ? styles.changeFlat
      : change > 0 === goodWhenUp
        ? styles.changeGood
        : styles.changeBad;
  const changeText = hasChange
    ? `${change > 0 ? '+' : ''}${changeUnit === 'pt' ? change.toFixed(1) + ' pt' : formatPercent(change)}`
    : '';
  return (
    <div className={styles.statCard} style={{ '--accent': color } as CSSProperties} data-reveal="">
      <div className={styles.statTop}>
        <span className={styles.statLabel}>{label}</span>
        <span className={styles.statIcon}>
          <MetricIcon name={accent} />
        </span>
      </div>
      <div className={styles.statValueRow}>
        <span className={styles.statValue} title={valueTitle}>
          {value}
        </span>
        {hasChange && (
          <span
            className={tone}
            title={t('usage_stats.change_hint')}
            aria-label={t('usage_stats.change_label', { value: changeText })}
          >
            {changeText}
          </span>
        )}
      </div>
      {sub && <span className={styles.statSub}>{sub}</span>}
      {spark && (
        <div className={styles.statSpark}>
          <Sparkline values={spark} color={color} />
        </div>
      )}
    </div>
  );
}
