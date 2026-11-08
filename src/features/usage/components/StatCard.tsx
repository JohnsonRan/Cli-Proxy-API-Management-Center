import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { METRIC_ACCENTS, type MetricAccent } from '../charts';
import { formatPercent } from '../format';
import { MetricIcon } from './MetricIcon';
import { Sparkline } from './Sparkline';
import styles from '../UsagePage.module.scss';

/**
 * Headline metric card on the shared `Card` surface. The metric accent colours only the
 * 6px label dot and sparkline so cards stay neutral while preserving chart colour mapping.
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
    <div className={styles.statCardReveal} data-reveal="">
      <Card className={styles.statCard}>
        <div className={styles.statTop}>
          <span className={styles.statLabelGroup}>
            <span
              className={styles.metricDot}
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            <span className={styles.statLabel}>{label}</span>
          </span>
          <span className={styles.statGlyph} aria-hidden="true">
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
      </Card>
    </div>
  );
}
