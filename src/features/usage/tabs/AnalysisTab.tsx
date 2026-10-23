import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar } from 'react-chartjs-2';
import {
  usageStoreApi,
  type UsageAnalysis,
  type UsageDimensionFilter,
  type UsageStats,
} from '@/services/api/usageStore';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { METRIC_ACCENTS, baseCartesianOptions, useChartTheme } from '../charts';
import { PanelHeading } from '../components/PanelBits';
import { ActivityHeatmap } from '../components/ActivityHeatmap';
import { StatCard } from '../components/StatCard';
import { USAGE_METRICS, formatCompact, formatMs, type UsageMetric } from '../format';
import { histogramLabels } from '../logic';
import type { UsageWindow } from '../UsagePage';
import styles from '../UsagePage.module.scss';

export function AnalysisTab({
  usageWindow,
  stats,
  dimensionFilter = {},
}: {
  usageWindow: UsageWindow;
  stats: UsageStats;
  dimensionFilter?: UsageDimensionFilter;
}) {
  const { t } = useTranslation();
  const theme = useChartTheme();
  const [analysis, setAnalysis] = useState<UsageAnalysis | null>(null);
  const [error, setError] = useState('');
  const [heatMetric, setHeatMetric] = useState<UsageMetric>('requests');
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setError('');
    try {
      const next = await usageStoreApi.getAnalysis(
        usageWindow.from,
        usageWindow.to,
        usageWindow.tzOffset,
        dimensionFilter
      );
      if (requestId === requestRef.current) setAnalysis(next);
    } catch (err: unknown) {
      if (requestId === requestRef.current) {
        setError(err instanceof Error ? err.message : t('notification.refresh_failed'));
      }
    }
  }, [dimensionFilter, t, usageWindow]);

  // `stats` changes on every refresh, so analysis follows the header refresh too.
  useEffect(() => {
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [load, stats, dimensionFilter]);

  const histogram = useMemo(() => {
    if (!analysis) return null;
    return {
      data: {
        labels: histogramLabels(analysis.histogramBoundsMs),
        datasets: [
          {
            label: t('usage_stats.metric_requests'),
            data: analysis.histogram,
            backgroundColor: METRIC_ACCENTS.latency,
            borderRadius: 3,
          },
        ],
      },
      options: {
        ...baseCartesianOptions(theme, false),
        plugins: {
          legend: { display: false },
          tooltip: { mode: 'index' as const, intersect: false },
        },
      },
    };
  }, [analysis, t, theme]);

  if (error) {
    return (
      <div className={styles.errorBanner} role="alert">
        {error}
      </div>
    );
  }
  if (!analysis || !histogram) {
    return <Skeleton height={320} rounded={14} />;
  }

  const { latency, ttft } = analysis;
  return (
    <>
      <section className={styles.cards} aria-label={t('usage_stats.latency_title')}>
        <StatCard
          accent="latency"
          label={t('usage_stats.latency_p50')}
          value={formatMs(latency.p50)}
        />
        <StatCard
          accent="latency"
          label={t('usage_stats.latency_p95')}
          value={formatMs(latency.p95)}
        />
        <StatCard
          accent="latency"
          label={t('usage_stats.latency_p99')}
          value={formatMs(latency.p99)}
          sub={t('usage_stats.latency_max', { value: formatMs(latency.max) })}
        />
        <StatCard accent="ttft" label={t('usage_stats.ttft_p50')} value={formatMs(ttft.p50)} />
        <StatCard
          accent="ttft"
          label={t('usage_stats.ttft_p95')}
          value={formatMs(ttft.p95)}
          sub={t('usage_stats.samples', { count: formatCompact(latency.count) })}
        />
      </section>
      {analysis.sampled && <p className={styles.muted}>{t('usage_stats.sampled_hint')}</p>}

      <div className={styles.split}>
        <section className={styles.panel}>
          <PanelHeading
            title={t('usage_stats.histogram_title')}
            desc={t('usage_stats.histogram_desc')}
          />
          <div
            className={styles.chartBoxSmall}
            role="img"
            aria-label={t('usage_stats.histogram_title')}
          >
            <Bar data={histogram.data} options={histogram.options} />
          </div>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <PanelHeading
              title={t('usage_stats.heatmap_title')}
              desc={t('usage_stats.heatmap_desc')}
            />
            <div
              className={styles.segmented}
              role="group"
              aria-label={t('usage_stats.metric_label')}
            >
              {USAGE_METRICS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={heatMetric === value ? styles.segmentActive : styles.segment}
                  aria-pressed={heatMetric === value}
                  onClick={() => setHeatMetric(value)}
                >
                  {t(`usage_stats.metric_${value}`)}
                </button>
              ))}
            </div>
          </div>
          <ActivityHeatmap cells={analysis.heatmap} metric={heatMetric} />
        </section>
      </div>

      <section className={styles.panel}>
        <PanelHeading
          title={t('usage_stats.model_latency_title')}
          desc={t('usage_stats.latency_hint')}
        />
        {analysis.models.length === 0 ? (
          <p className={styles.muted}>{t('usage_stats.no_data')}</p>
        ) : (
          <Table className={styles.table}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('usage_stats.col_model')}</TableHead>
                <TableHead alignRight>{t('usage_stats.col_samples')}</TableHead>
                <TableHead alignRight>P50</TableHead>
                <TableHead alignRight>P95</TableHead>
                <TableHead alignRight>P99</TableHead>
                <TableHead alignRight>{t('usage_stats.col_ttft_p50')}</TableHead>
                <TableHead alignRight>{t('usage_stats.col_ttft_p95')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.models.map((m) => (
                <TableRow key={m.model}>
                  <TableCell className={styles.mono}>{m.model}</TableCell>
                  <TableCell alignRight>{formatCompact(m.latency.count)}</TableCell>
                  <TableCell alignRight>{formatMs(m.latency.p50)}</TableCell>
                  <TableCell alignRight>{formatMs(m.latency.p95)}</TableCell>
                  <TableCell alignRight>{formatMs(m.latency.p99)}</TableCell>
                  <TableCell alignRight>{formatMs(m.ttft.p50)}</TableCell>
                  <TableCell alignRight>{formatMs(m.ttft.p95)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </>
  );
}
