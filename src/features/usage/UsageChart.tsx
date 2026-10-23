import { useTranslation } from 'react-i18next';
import type { UsageSeriesPoint } from '@/services/api/usageStore';
import {
  barFractions,
  formatBucketLabel,
  formatMetric,
  metricValue,
  type UsageMetric,
} from './format';
import styles from './UsagePage.module.scss';

const HEIGHT = 160;

export function UsageChart({
  series,
  bucket,
  metric,
}: {
  series: UsageSeriesPoint[];
  bucket: 'hour' | 'day';
  metric: UsageMetric;
}) {
  const { t, i18n } = useTranslation();
  const fractions = barFractions(series, metric);
  const width = Math.max(series.length, 1);
  const peak = Math.max(0, ...series.map((p) => metricValue(p, metric)));
  const first = series[0];
  const last = series[series.length - 1];

  return (
    <figure className={styles.chart}>
      <svg
        className={styles.chartSvg}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t('usage_stats.chart_label', {
          metric: t(`usage_stats.metric_${metric}`),
          peak: formatMetric(peak, metric),
        })}
      >
        {series.map((point, index) => {
          const h = fractions[index] * (HEIGHT - 4);
          const failedShare = point.requests > 0 ? point.failed / point.requests : 0;
          return (
            <g key={point.time}>
              <rect
                className={styles.chartBar}
                x={index + 0.12}
                y={HEIGHT - h}
                width={0.76}
                height={h}
              >
                <title>
                  {`${formatBucketLabel(point.time, bucket, i18n.language)} · ${formatMetric(
                    metricValue(point, metric),
                    metric
                  )}`}
                </title>
              </rect>
              {metric === 'requests' && failedShare > 0 && (
                <rect
                  className={styles.chartBarFailed}
                  x={index + 0.12}
                  y={HEIGHT - h * failedShare}
                  width={0.76}
                  height={h * failedShare}
                />
              )}
            </g>
          );
        })}
      </svg>
      {first && last && (
        <figcaption className={styles.chartAxis}>
          <span>{formatBucketLabel(first.time, bucket, i18n.language)}</span>
          <span>{t('usage_stats.chart_peak', { value: formatMetric(peak, metric) })}</span>
          <span>{formatBucketLabel(last.time, bucket, i18n.language)}</span>
        </figcaption>
      )}
    </figure>
  );
}
