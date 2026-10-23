import { useMemo, useState, type ReactNode } from 'react';
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
import {
  METRIC_ACCENTS,
  SERIES_COLORS,
  baseCartesianOptions,
  rankColor,
  useChartTheme,
} from '../charts';
import { PanelHeading, Rate } from '../components/PanelBits';
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
import { KeyLabel, ProviderBadge } from '../components/Labels';
import type { UsageLabels } from '../hooks/useUsageLabels';
import styles from '../UsagePage.module.scss';

interface OverviewTabProps {
  stats: UsageStats;
  prevStats: UsageStats | null;
  labels: UsageLabels;
  onOpenEvents: (filter: EventsFilter) => void;
}

/** Request count with a share bar in the row's colour. */
function Share({ value, total, color }: { value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <span className={styles.share}>
      <span className={styles.shareText}>{formatCompact(value)}</span>
      <span className={styles.shareTrack}>
        <span className={styles.shareBar} style={{ width: `${pct}%`, background: color }} />
      </span>
    </span>
  );
}

/** Leading cell of a ranked row: rank, colour dot, name and optional caption. */
function RankName({
  rank,
  color,
  name,
  sub,
  mono,
}: {
  rank: number;
  color: string;
  name: ReactNode;
  sub?: ReactNode;
  mono?: boolean;
}) {
  return (
    <span className={styles.rankName}>
      <span className={styles.rank}>{rank}</span>
      <span className={styles.dot} style={{ background: color }} />
      <span className={styles.rankText}>
        <span className={mono ? `${styles.cellStrong} ${styles.mono}` : styles.cellStrong}>
          {name}
        </span>
        {sub && <span className={styles.cellSub}>{sub}</span>}
      </span>
    </span>
  );
}

export function OverviewTab({ stats, prevStats, labels, onOpenEvents }: OverviewTabProps) {
  const { t, i18n } = useTranslation();
  const theme = useChartTheme();
  const [metric, setMetric] = useState<UsageMetric>('requests');
  const totals = stats.totals;
  const prev = prevStats?.totals;
  const rate = successRate(totals);
  const prevRate = prev ? successRate(prev) : null;

  const bucketLabels = useMemo(
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
          labels: bucketLabels,
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
          labels: bucketLabels,
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
        labels: bucketLabels,
        datasets: [
          {
            label: t('usage_stats.metric_cost'),
            data: stats.series.map((p) => p.cost),
            borderColor: METRIC_ACCENTS.cost,
            backgroundColor: `${METRIC_ACCENTS.cost}33`,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
          },
        ],
      },
    };
  }, [bucketLabels, metric, stats.series, t, theme]);

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
    const top = stats.models
      .map((m, index) => ({ ...m, color: rankColor(index) }))
      .filter((m) => m.cost > 0)
      .slice(0, 8);
    return {
      data: {
        labels: top.map((m) => m.model),
        datasets: [
          {
            data: top.map((m) => m.cost),
            backgroundColor: top.map((m) => m.color),
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
      <span className={styles.cellStrong}>{formatCost(a.cost)}</span>
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
          accent="requests"
          label={t('usage_stats.card_requests')}
          value={formatCompact(totals.requests)}
          change={prev ? changePercent(totals.requests, prev.requests) : undefined}
          spark={stats.series.map((p) => p.requests)}
          sub={
            <>
              <span className={styles.legendDot} style={{ background: theme.success }} />
              {t('usage_stats.card_succeeded', { count: totals.requests - totals.failed })}
              <span className={styles.legendDot} style={{ background: theme.failure }} />
              {t('usage_stats.card_failed', { count: totals.failed })}
            </>
          }
        />
        <StatCard
          accent="success"
          label={t('usage_stats.card_success_rate')}
          value={formatPercent(rate)}
          change={rate !== null && prevRate !== null ? rate - prevRate : undefined}
          changeUnit="pt"
          spark={stats.series.map((p) => successRate(p) ?? 0)}
        />
        <StatCard
          accent="tokens"
          label={t('usage_stats.card_tokens')}
          value={formatCompact(totals.tokens.total)}
          change={prev ? changePercent(totals.tokens.total, prev.tokens.total) : undefined}
          spark={stats.series.map((p) => p.tokens.total)}
          sub={t('usage_stats.card_tokens_sub', {
            input: formatCompact(inputTokens(totals)),
            output: formatCompact(totals.tokens.output),
          })}
        />
        <StatCard
          accent="cost"
          label={t('usage_stats.card_cost')}
          value={formatCost(totals.cost)}
          change={prev ? changePercent(totals.cost, prev.cost) : undefined}
          goodWhenUp={false}
          spark={stats.series.map((p) => p.cost)}
          sub={
            totals.unpricedRequests > 0
              ? t('usage_stats.card_unpriced', { count: totals.unpricedRequests })
              : t('usage_stats.card_cost_sub')
          }
        />
        <StatCard
          accent="cache"
          label={t('usage_stats.card_cache_hit')}
          value={formatPercent(cacheHitRate(totals))}
          spark={stats.series.map((p) => cacheHitRate(p) ?? 0)}
          sub={t('usage_stats.card_cache_hit_sub', {
            cached: formatCompact(totals.tokens.cacheRead),
          })}
        />
        <StatCard
          accent="latency"
          label={t('usage_stats.card_latency')}
          value={formatMs(totals.avgLatencyMs)}
          change={
            prev && prev.avgLatencyMs > 0
              ? changePercent(totals.avgLatencyMs, prev.avgLatencyMs)
              : undefined
          }
          goodWhenUp={false}
          spark={stats.series.map((p) => p.avgLatencyMs)}
          sub={t('usage_stats.card_ttft', { value: formatMs(totals.avgTtftMs) })}
        />
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <PanelHeading title={t('usage_stats.trend_title')} desc={t('usage_stats.trend_desc')} />
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
          <PanelHeading
            title={t('usage_stats.composition_title')}
            desc={t('usage_stats.composition_desc')}
          />
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
          <PanelHeading
            title={t('usage_stats.cost_by_model_title')}
            desc={t('usage_stats.cost_by_model_desc')}
          />
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
        <PanelHeading title={t('usage_stats.models_title')} desc={t('usage_stats.models_desc')} />
        {stats.models.length === 0 ? (
          <p className={styles.muted}>{t('usage_stats.no_data')}</p>
        ) : (
          <Table className={styles.table}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('usage_stats.col_model')}</TableHead>
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
              {stats.models.map((m, index) => (
                <TableRow
                  key={`${m.provider}:${m.model}`}
                  {...rowProps({ model: m.model, provider: m.provider }, m.model)}
                >
                  <TableCell>
                    <RankName
                      rank={index + 1}
                      color={rankColor(index)}
                      name={
                        <>
                          <span>{m.model}</span>
                          {m.substituted > 0 && (
                            <span
                              className={styles.substitutedBadge}
                              title={t('usage_stats.model_substituted_count', {
                                count: m.substituted,
                              })}
                              aria-label={t('usage_stats.model_substituted_count', {
                                count: m.substituted,
                              })}
                            >
                              {m.substituted}
                            </span>
                          )}
                        </>
                      }
                      sub={<ProviderBadge provider={m.provider} />}
                      mono
                    />
                  </TableCell>
                  <TableCell alignRight>
                    <Share value={m.requests} total={totals.requests} color={rankColor(index)} />
                  </TableCell>
                  <TableCell alignRight>
                    <Rate value={successRate(m)} />
                  </TableCell>
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
          <PanelHeading title={t('usage_stats.keys_title')} desc={t('usage_stats.keys_desc')} />
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
                {stats.apiKeys.map((k, index) => (
                  <TableRow
                    key={k.apiKeyId || 'none'}
                    {...rowProps(
                      { api_key_id: k.apiKeyId },
                      labels.keyName(k.apiKeyId) || k.apiKey || t('usage_stats.none')
                    )}
                  >
                    <TableCell>
                      <RankName
                        rank={index + 1}
                        color={rankColor(index)}
                        name={<KeyLabel name={labels.keyName(k.apiKeyId)} masked={k.apiKey} />}
                      />
                    </TableCell>
                    <TableCell alignRight>
                      <Share value={k.requests} total={totals.requests} color={rankColor(index)} />
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
          <PanelHeading
            title={t('usage_stats.credentials_title')}
            desc={t('usage_stats.credentials_desc')}
          />
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
                {stats.credentials.map((c, index) => (
                  <TableRow
                    key={c.authIndex || 'none'}
                    {...rowProps(
                      { auth_index: c.authIndex },
                      labels.credential(c.authIndex, c.source)
                    )}
                  >
                    <TableCell>
                      <RankName
                        rank={index + 1}
                        color={rankColor(index)}
                        name={labels.credential(c.authIndex, c.source)}
                        sub={<ProviderBadge provider={c.provider} />}
                      />
                    </TableCell>
                    <TableCell alignRight>
                      <Share value={c.requests} total={totals.requests} color={rankColor(index)} />
                    </TableCell>
                    <TableCell alignRight>
                      <Rate value={successRate(c)} />
                    </TableCell>
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
