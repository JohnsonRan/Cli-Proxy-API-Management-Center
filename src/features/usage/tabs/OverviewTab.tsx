import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import type { UsageAggregate, UsageStats } from '@/services/api/usageStore';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { SERIES_COLORS, baseCartesianOptions, useChartTheme } from '../charts';
import { StatCard } from '../components/StatCard';
import {
  USAGE_METRICS,
  cacheHitRate,
  changePercent,
  formatBucketLabel,
  formatCompact,
  formatCost,
  formatMs,
  formatPercent,
  inputTokens,
  successRate,
  type UsageMetric,
} from '../format';
import type { EventsFilter } from '../logic';
import styles from '../UsagePage.module.scss';

interface OverviewTabProps {
  stats: UsageStats;
  prevStats: UsageStats | null;
  credentialLabel: (authIndex: string) => string;
  onOpenEvents: (filter: EventsFilter) => void;
}

/** Share bar shown behind a row's request count. */
function Share({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <span className={styles.share}>
      <span className={styles.shareBar} style={{ width: `${pct}%` }} />
      <span className={styles.shareText}>{formatCompact(value)}</span>
    </span>
  );
}

export function OverviewTab({ stats, prevStats, credentialLabel, onOpenEvents }: OverviewTabProps) {
  const { t, i18n } = useTranslation();
  const theme = useChartTheme();
  const [metric, setMetric] = useState<UsageMetric>('requests');
  const totals = stats.totals;
  const prev = prevStats?.totals;
  const rate = successRate(totals);
  const prevRate = prev ? successRate(prev) : null;

  const labels = useMemo(
    () => stats.series.map((p) => formatBucketLabel(p.time, stats.bucket, i18n.language)),
    [stats.series, stats.bucket, i18n.language]
  );

  const trend = useMemo(() => {
    const options = baseCartesianOptions(theme, metric !== 'cost');
    if (metric === 'requests') {
      return {
        kind: 'bar' as const,
        options,
        data: {
          labels,
          datasets: [
            {
              label: t('usage_stats.series_success'),
              data: stats.series.map((p) => p.requests - p.failed),
              backgroundColor: theme.success,
              borderRadius: 3,
            },
            {
              label: t('usage_stats.series_failed'),
              data: stats.series.map((p) => p.failed),
              backgroundColor: theme.failure,
              borderRadius: 3,
            },
          ],
        },
      };
    }
    if (metric === 'tokens') {
      const series = [
        ['series_input', (p: UsageAggregate) => p.tokens.inputUncached + p.tokens.unclassified],
        ['series_cache_read', (p: UsageAggregate) => p.tokens.cacheRead],
        ['series_cache_write', (p: UsageAggregate) => p.tokens.cacheWrite],
        ['series_output', (p: UsageAggregate) => p.tokens.output],
      ] as const;
      return {
        kind: 'bar' as const,
        options,
        data: {
          labels,
          datasets: series.map(([key, pick], index) => ({
            label: t(`usage_stats.${key}`),
            data: stats.series.map(pick),
            backgroundColor: SERIES_COLORS[index],
            borderRadius: 3,
          })),
        },
      };
    }
    return {
      kind: 'line' as const,
      options: {
        ...options,
        plugins: {
          ...options.plugins,
          tooltip: {
            ...options.plugins.tooltip,
            callbacks: {
              label: (ctx: { parsed: { y: number | null } }) => formatCost(ctx.parsed.y ?? 0),
            },
          },
        },
      },
      data: {
        labels,
        datasets: [
          {
            label: t('usage_stats.metric_cost'),
            data: stats.series.map((p) => p.cost),
            borderColor: SERIES_COLORS[0],
            backgroundColor: `${SERIES_COLORS[0]}33`,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
          },
        ],
      },
    };
  }, [labels, metric, stats.series, t, theme]);

  const composition = useMemo(() => {
    const parts = [
      ['series_input', totals.tokens.inputUncached + totals.tokens.unclassified],
      ['series_cache_read', totals.tokens.cacheRead],
      ['series_cache_write', totals.tokens.cacheWrite],
      ['series_output_text', totals.tokens.output - totals.tokens.reasoning],
      ['series_reasoning', totals.tokens.reasoning],
    ] as const;
    return {
      data: {
        labels: parts.map(([key]) => t(`usage_stats.${key}`)),
        datasets: [
          {
            data: parts.map(([, value]) => value),
            backgroundColor: SERIES_COLORS.slice(0, parts.length),
            borderColor: theme.surface,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false as const,
        cutout: '62%',
        plugins: {
          legend: {
            position: 'right' as const,
            labels: { color: theme.text, boxWidth: 10, boxHeight: 10, usePointStyle: true },
          },
        },
      },
    };
  }, [t, theme, totals]);

  const modelCost = useMemo(() => {
    const top = stats.models.filter((m) => m.cost > 0).slice(0, 8);
    return {
      data: {
        labels: top.map((m) => m.model),
        datasets: [
          {
            data: top.map((m) => m.cost),
            backgroundColor: SERIES_COLORS.slice(0, top.length),
            borderColor: theme.surface,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false as const,
        cutout: '62%',
        plugins: {
          legend: {
            position: 'right' as const,
            labels: { color: theme.text, boxWidth: 10, boxHeight: 10, usePointStyle: true },
          },
          tooltip: {
            callbacks: {
              label: (ctx: { label: string; parsed: number }) =>
                `${ctx.label}: ${formatCost(ctx.parsed)}`,
            },
          },
        },
      },
      empty: top.length === 0,
    };
  }, [stats.models, theme]);

  const costCell = (a: UsageAggregate) =>
    a.unpricedRequests >= a.requests && a.requests > 0 ? (
      <span className={styles.muted}>{t('usage_stats.unpriced')}</span>
    ) : (
      formatCost(a.cost)
    );

  const rowProps = (filter: EventsFilter, label: string) => ({
    className: styles.clickableRow,
    tabIndex: 0,
    title: t('usage_stats.open_events'),
    'aria-label': t('usage_stats.open_events_for', { name: label }),
    onClick: () => onOpenEvents(filter),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpenEvents(filter);
      }
    },
  });

  return (
    <>
      <section className={styles.cards} aria-label={t('usage_stats.summary_label')}>
        <StatCard
          label={t('usage_stats.card_requests')}
          value={formatCompact(totals.requests)}
          change={prev ? changePercent(totals.requests, prev.requests) : undefined}
          sub={t('usage_stats.card_failed', { count: totals.failed })}
        />
        <StatCard
          label={t('usage_stats.card_success_rate')}
          value={formatPercent(rate)}
          change={rate !== null && prevRate !== null ? rate - prevRate : undefined}
          sub={rate !== null && prevRate !== null ? t('usage_stats.change_points') : undefined}
        />
        <StatCard
          label={t('usage_stats.card_tokens')}
          value={formatCompact(totals.tokens.total)}
          change={prev ? changePercent(totals.tokens.total, prev.tokens.total) : undefined}
          sub={t('usage_stats.card_tokens_sub', {
            input: formatCompact(inputTokens(totals)),
            output: formatCompact(totals.tokens.output),
          })}
        />
        <StatCard
          label={t('usage_stats.card_cost')}
          value={formatCost(totals.cost)}
          change={prev ? changePercent(totals.cost, prev.cost) : undefined}
          goodWhenUp={false}
          sub={
            totals.unpricedRequests > 0
              ? t('usage_stats.card_unpriced', { count: totals.unpricedRequests })
              : t('usage_stats.card_cost_sub')
          }
        />
        <StatCard
          label={t('usage_stats.card_cache_hit')}
          value={formatPercent(cacheHitRate(totals))}
          sub={t('usage_stats.card_cache_hit_sub', {
            cached: formatCompact(totals.tokens.cacheRead),
          })}
        />
        <StatCard
          label={t('usage_stats.card_latency')}
          value={formatMs(totals.avgLatencyMs)}
          change={
            prev && prev.avgLatencyMs > 0
              ? changePercent(totals.avgLatencyMs, prev.avgLatencyMs)
              : undefined
          }
          goodWhenUp={false}
          sub={t('usage_stats.card_ttft', { value: formatMs(totals.avgTtftMs) })}
        />
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>{t('usage_stats.trend_title')}</h2>
          <div className={styles.segmented} role="group" aria-label={t('usage_stats.metric_label')}>
            {USAGE_METRICS.map((value) => (
              <button
                key={value}
                type="button"
                className={metric === value ? styles.segmentActive : styles.segment}
                aria-pressed={metric === value}
                onClick={() => setMetric(value)}
              >
                {t(`usage_stats.metric_${value}`)}
              </button>
            ))}
          </div>
        </div>
        <div
          className={styles.chartBox}
          role="img"
          aria-label={t('usage_stats.chart_label', { metric: t(`usage_stats.metric_${metric}`) })}
        >
          {trend.kind === 'bar' ? (
            <Bar data={trend.data} options={trend.options} />
          ) : (
            <Line data={trend.data} options={trend.options} />
          )}
        </div>
      </section>

      <div className={styles.split}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t('usage_stats.composition_title')}</h2>
          <div
            className={styles.chartBoxSmall}
            role="img"
            aria-label={t('usage_stats.composition_title')}
          >
            {totals.tokens.total > 0 ? (
              <Doughnut data={composition.data} options={composition.options} />
            ) : (
              <p className={styles.muted}>{t('usage_stats.no_data')}</p>
            )}
          </div>
        </section>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t('usage_stats.cost_by_model_title')}</h2>
          <div
            className={styles.chartBoxSmall}
            role="img"
            aria-label={t('usage_stats.cost_by_model_title')}
          >
            {modelCost.empty ? (
              <p className={styles.muted}>{t('usage_stats.no_cost')}</p>
            ) : (
              <Doughnut data={modelCost.data} options={modelCost.options} />
            )}
          </div>
        </section>
      </div>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{t('usage_stats.models_title')}</h2>
        {stats.models.length === 0 ? (
          <p className={styles.muted}>{t('usage_stats.no_data')}</p>
        ) : (
          <Table className={styles.table}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('usage_stats.col_model')}</TableHead>
                <TableHead>{t('usage_stats.col_provider')}</TableHead>
                <TableHead alignRight>{t('usage_stats.col_requests')}</TableHead>
                <TableHead alignRight>{t('usage_stats.col_success_rate')}</TableHead>
                <TableHead alignRight>{t('usage_stats.col_input')}</TableHead>
                <TableHead alignRight>{t('usage_stats.col_cached')}</TableHead>
                <TableHead alignRight>{t('usage_stats.col_output')}</TableHead>
                <TableHead alignRight>{t('usage_stats.col_latency')}</TableHead>
                <TableHead alignRight>{t('usage_stats.col_cost')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.models.map((m) => (
                <TableRow
                  key={`${m.provider}:${m.model}`}
                  {...rowProps({ model: m.model, provider: m.provider }, m.model)}
                >
                  <TableCell className={styles.mono}>{m.model}</TableCell>
                  <TableCell>{m.provider}</TableCell>
                  <TableCell alignRight>
                    <Share value={m.requests} total={totals.requests} />
                  </TableCell>
                  <TableCell alignRight>{formatPercent(successRate(m))}</TableCell>
                  <TableCell alignRight>{formatCompact(inputTokens(m))}</TableCell>
                  <TableCell alignRight>{formatCompact(m.tokens.cacheRead)}</TableCell>
                  <TableCell alignRight>{formatCompact(m.tokens.output)}</TableCell>
                  <TableCell alignRight>{formatMs(m.avgLatencyMs)}</TableCell>
                  <TableCell alignRight>{costCell(m)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <div className={styles.split}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t('usage_stats.keys_title')}</h2>
          {stats.apiKeys.length === 0 ? (
            <p className={styles.muted}>{t('usage_stats.no_data')}</p>
          ) : (
            <Table className={styles.table}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('usage_stats.col_key')}</TableHead>
                  <TableHead alignRight>{t('usage_stats.col_requests')}</TableHead>
                  <TableHead alignRight>{t('usage_stats.col_tokens')}</TableHead>
                  <TableHead alignRight>{t('usage_stats.col_cost')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.apiKeys.map((k) => (
                  <TableRow
                    key={k.apiKeyId || 'none'}
                    {...rowProps({ api_key_id: k.apiKeyId }, k.apiKey || t('usage_stats.none'))}
                  >
                    <TableCell className={styles.mono}>
                      {k.apiKey || t('usage_stats.none')}
                    </TableCell>
                    <TableCell alignRight>
                      <Share value={k.requests} total={totals.requests} />
                    </TableCell>
                    <TableCell alignRight>{formatCompact(k.tokens.total)}</TableCell>
                    <TableCell alignRight>{costCell(k)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{t('usage_stats.credentials_title')}</h2>
          {stats.credentials.length === 0 ? (
            <p className={styles.muted}>{t('usage_stats.no_data')}</p>
          ) : (
            <Table className={styles.table}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('usage_stats.col_credential')}</TableHead>
                  <TableHead alignRight>{t('usage_stats.col_requests')}</TableHead>
                  <TableHead alignRight>{t('usage_stats.col_success_rate')}</TableHead>
                  <TableHead alignRight>{t('usage_stats.col_cost')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.credentials.map((c) => (
                  <TableRow
                    key={c.authIndex || 'none'}
                    {...rowProps({ auth_index: c.authIndex }, credentialLabel(c.authIndex))}
                  >
                    <TableCell>
                      <span className={styles.cellMain}>{credentialLabel(c.authIndex)}</span>
                      <span className={styles.cellSub}>{c.provider}</span>
                    </TableCell>
                    <TableCell alignRight>
                      <Share value={c.requests} total={totals.requests} />
                    </TableCell>
                    <TableCell alignRight>{formatPercent(successRate(c))}</TableCell>
                    <TableCell alignRight>{costCell(c)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      </div>
    </>
  );
}
