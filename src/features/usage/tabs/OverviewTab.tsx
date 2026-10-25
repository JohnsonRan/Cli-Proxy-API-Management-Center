import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Chart, Doughnut } from 'react-chartjs-2';
import type {
  UsageAggregate,
  UsageApiKeyStat,
  UsageCredentialStat,
  UsageModelPrice,
  UsageModelStat,
  UsageStats,
} from '@/services/api/usageStore';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { useQuotaBatchLoader } from '@/features/quota/hooks/useQuotaBatchLoader';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaStore } from '@/features/quota/providers/types';
import { useNow } from '@/hooks/useNow';
import { useAuthStore, useQuotaStore } from '@/stores';
import { downloadBlob } from '@/utils/download';
import {
  METRIC_ACCENTS,
  SERIES_COLORS,
  baseCartesianOptions,
  chartAnimation,
  rankColor,
  useChartTheme,
} from '../charts';
import { Compact, PanelHeading, Rate } from '../components/PanelBits';
import { StatCard } from '../components/StatCard';
import {
  TREND_METRICS,
  cacheHitRate,
  changePercent,
  costPerMillionTokens,
  costPerRequest,
  exactCost,
  exactCount,
  formatBucketLabel,
  formatCompact,
  formatCost,
  formatMs,
  formatPercent,
  formatTps,
  inputTokens,
  successRate,
  tokensPerRequest,
  type TrendMetric,
} from '../format';
import {
  alignPrevious,
  cacheSavings,
  readUsagePrefs,
  saveUsagePrefs,
  sortRows,
  toCsv,
  type EventsFilter,
  type SortState,
} from '../logic';
import { SortHead } from '../components/SortHead';
import { useSort } from '../hooks/useSort';
import { KeyLabel, ProviderBadge } from '../components/Labels';
import { CredentialQuotaCell } from '../components/CredentialQuotaCell';
import {
  CredentialQuotaModal,
  type CredentialQuotaModalTarget,
} from '../components/CredentialQuotaModal';
import { CountUp } from '../components/Motion';
import type { UsageLabels } from '../hooks/useUsageLabels';
import {
  collectCredentialQuotaTargets,
  readCachedQuota,
  summarizeCredentialQuota,
  type CredentialQuotaSummary,
} from '../quota';
import styles from '../UsagePage.module.scss';

interface OverviewTabProps {
  stats: UsageStats;
  prevStats: UsageStats | null;
  /** Effective model prices, used to estimate what cache reads saved. */
  prices: UsageModelPrice[];
  labels: UsageLabels;
  onOpenEvents: (filter: EventsFilter) => void;
  /** Narrows the global time range to one trend bucket and opens its requests. */
  onDrillDown: (from: number, to: number) => void;
  connected?: boolean;
  nowMs?: number;
}

/** Request count with a share bar in the row's colour. */
function Share({ value, total, color }: { value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <span className={styles.share}>
      <span className={styles.shareText}>
        <Compact value={value} />
      </span>
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

type CsvField<T> = [label: string, value: (row: T) => string | number];

interface Column<T> {
  key: string;
  label: string;
  /** Text columns sort A→Z first; numeric ones largest first. */
  text?: boolean;
  /** Sort value; null sorts last. */
  value: (row: T) => number | string | null;
}

/** Rows in the current sort, each keeping the colour of its default (by requests) rank. */
const ranked = <T,>(rows: T[], columns: Column<T>[], sort: SortState | null) => {
  const column = sort ? columns.find((c) => c.key === sort.key) : undefined;
  return sortRows(
    rows.map((row, index) => ({ row, color: rankColor(index) })),
    column ? (item) => column.value(item.row) : undefined,
    sort?.dir ?? 'desc'
  );
};

const sortHeads = <T,>(columns: Column<T>[], { sort, toggle }: ReturnType<typeof useSort>) =>
  columns.map((column, index) => (
    <SortHead
      key={column.key}
      label={column.label}
      sortKey={column.key}
      text={column.text}
      alignRight={index > 0}
      sort={sort}
      onSort={toggle}
    />
  ));

export function OverviewTab({
  stats,
  prevStats,
  prices,
  labels,
  onOpenEvents,
  onDrillDown,
  connected,
  nowMs,
}: OverviewTabProps) {
  const { t, i18n } = useTranslation();
  const theme = useChartTheme();
  const storeConnected = useAuthStore((state) => state.connectionStatus === 'connected');
  const isConnected = connected ?? storeConnected;
  const quotaStore = useSyncExternalStore(
    useQuotaStore.subscribe,
    useQuotaStore.getState,
    useQuotaStore.getState
  ) as unknown as QuotaStore;
  const { batchLoading, loadQuota } = useQuotaBatchLoader();
  const [selectedQuotaKey, setSelectedQuotaKey] = useState<{
    authIndex: string;
    source: string;
    provider: string;
  } | null>(null);
  const [metric, setMetricState] = useState<TrendMetric>(
    () => readUsagePrefs().metric ?? 'requests'
  );
  const setMetric = (next: TrendMetric) => {
    setMetricState(next);
    saveUsagePrefs({ metric: next });
  };
  const [comparePrevious, setComparePrevious] = useState(
    () => readUsagePrefs().comparePrevious ?? false
  );
  const toggleComparePrevious = () => {
    setComparePrevious(!comparePrevious);
    saveUsagePrefs({ comparePrevious: !comparePrevious });
  };
  const totals = stats.totals;
  const prev = prevStats?.totals;
  const rate = successRate(totals);
  const prevRate = prev ? successRate(prev) : null;
  const cacheRate = cacheHitRate(totals);
  const saved = useMemo(() => cacheSavings(stats.models, prices), [prices, stats.models]);

  const bucketLabels = useMemo(
    () => stats.series.map((p) => formatBucketLabel(p.time, stats.bucket, i18n.language)),
    [stats.series, stats.bucket, i18n.language]
  );

  const trend = useMemo(() => {
    const step = stats.bucket === 'day' ? 86400 : 3600;
    // The previous window has the same length, so bucket i lines up with bucket i.
    const pickTotal =
      metric === 'requests'
        ? (p: UsageAggregate) => p.requests
        : metric === 'tokens'
          ? (p: UsageAggregate) => p.tokens.total
          : (p: UsageAggregate) => p.cost;
    // Three dashed previous lines would bury the combined view, so it skips the comparison.
    const previous =
      comparePrevious && prevStats && metric !== 'combined'
        ? [
            {
              type: 'line' as const,
              label: t('usage_stats.series_previous'),
              data: alignPrevious(stats.series, prevStats.series).map((point) =>
                point ? pickTotal(point) : null
              ),
              borderColor: theme.muted,
              backgroundColor: 'transparent',
              borderDash: [5, 4],
              borderWidth: 1.5,
              pointRadius: 0,
              fill: false,
              tension: 0.3,
              // Its own stack, so stacked bar charts do not add it on top of the bars.
              stack: 'previous',
              order: 0,
            },
          ]
        : [];
    const options = {
      ...baseCartesianOptions(
        theme,
        metric === 'requests' || metric === 'tokens',
        metric === 'cost' ? formatCost : formatCompact
      ),
      // Clicking a bucket narrows the range to it and opens its requests.
      onClick: (_event: unknown, elements: { index: number }[]) => {
        const point = elements[0] ? stats.series[elements[0].index] : undefined;
        if (point) onDrillDown(point.time, point.time + step);
      },
      onHover: (event: { native: Event | null }, elements: unknown[]) => {
        const target = event.native?.target as HTMLElement | null;
        if (target) target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
      },
    };
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
              order: 1,
            },
            {
              label: t('usage_stats.series_failed'),
              data: stats.series.map((p) => p.failed),
              backgroundColor: theme.failure,
              borderRadius: 3,
              order: 1,
            },
            ...previous,
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
          datasets: [
            ...series.map(([key, pick], index) => ({
              label: t(`usage_stats.${key}`),
              data: stats.series.map(pick),
              backgroundColor: SERIES_COLORS[index],
              borderRadius: 3,
              order: 1,
            })),
            ...previous,
          ],
        },
      };
    }
    if (metric === 'combined') {
      // Each metric keeps its own scale; the axis ticks take the series colour to tell them apart.
      const axis = (
        color: string,
        format: (value: number) => string,
        position: 'left' | 'right',
        grid: boolean
      ) => ({
        position,
        beginAtZero: true,
        ticks: {
          color,
          maxTicksLimit: 6,
          ...(format === formatCompact ? { precision: 0 } : {}),
          callback: (value: number | string) => format(Number(value)),
        },
        grid: grid ? { color: theme.grid } : { display: false },
        border: { display: false },
      });
      const line = (key: 'tokens' | 'cost', data: number[], order: number) => ({
        type: 'line' as const,
        label: t(`usage_stats.metric_${key}`),
        data,
        yAxisID: key,
        borderColor: METRIC_ACCENTS[key],
        backgroundColor: METRIC_ACCENTS[key],
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 3,
        tension: 0.3,
        fill: false,
        order,
      });
      return {
        kind: 'bar' as const,
        options: {
          ...options,
          plugins: {
            ...options.plugins,
            // Draw order puts lines over bars; keep the legend and tooltip in metric order.
            legend: {
              ...options.plugins.legend,
              labels: {
                ...options.plugins.legend.labels,
                sort: (a: { datasetIndex?: number }, b: { datasetIndex?: number }) =>
                  (a.datasetIndex ?? 0) - (b.datasetIndex ?? 0),
              },
            },
            tooltip: {
              ...options.plugins.tooltip,
              itemSort: (a: { datasetIndex: number }, b: { datasetIndex: number }) =>
                a.datasetIndex - b.datasetIndex,
              callbacks: {
                label: (ctx: {
                  dataset: { label?: string; yAxisID?: string };
                  parsed: { y: number | null };
                }) => {
                  const format = ctx.dataset.yAxisID === 'cost' ? formatCost : formatCompact;
                  return `${ctx.dataset.label}: ${format(ctx.parsed.y ?? 0)}`;
                },
              },
            },
          },
          scales: {
            x: options.scales.x,
            y: axis(METRIC_ACCENTS.requests, formatCompact, 'left', true),
            tokens: axis(METRIC_ACCENTS.tokens, formatCompact, 'right', false),
            cost: axis(METRIC_ACCENTS.cost, formatCost, 'right', false),
          },
        },
        data: {
          labels: bucketLabels,
          datasets: [
            {
              type: 'bar' as const,
              label: t('usage_stats.metric_requests'),
              data: stats.series.map((p) => p.requests),
              yAxisID: 'y',
              backgroundColor: `${METRIC_ACCENTS.requests}99`,
              borderRadius: 3,
              order: 2,
            },
            line(
              'tokens',
              stats.series.map((p) => p.tokens.total),
              1
            ),
            line(
              'cost',
              stats.series.map((p) => p.cost),
              0
            ),
          ],
        },
      };
    }
    return {
      kind: 'line' as const,
      options,
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
            order: 1,
          },
          ...previous,
        ],
      },
    };
  }, [
    bucketLabels,
    comparePrevious,
    metric,
    onDrillDown,
    prevStats,
    stats.bucket,
    stats.series,
    t,
    theme,
  ]);

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
        animation: chartAnimation(),
        cutout: '62%',
        plugins: {
          legend: {
            position: 'right' as const,
            labels: { color: theme.text, boxWidth: 10, boxHeight: 10, usePointStyle: true },
          },
          tooltip: {
            callbacks: {
              label: (ctx: { label: string; parsed: number }) =>
                `${ctx.label}: ${formatCompact(ctx.parsed)} (${formatPercent(
                  totals.tokens.total > 0 ? (ctx.parsed / totals.tokens.total) * 100 : null
                )})`,
            },
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
        animation: chartAnimation(),
        cutout: '62%',
        plugins: {
          legend: {
            position: 'right' as const,
            labels: { color: theme.text, boxWidth: 10, boxHeight: 10, usePointStyle: true },
          },
          tooltip: {
            callbacks: {
              label: (ctx: { label: string; parsed: number }) =>
                `${ctx.label}: ${formatCost(ctx.parsed)} (${formatPercent(
                  totals.cost > 0 ? (ctx.parsed / totals.cost) * 100 : null
                )})`,
            },
          },
        },
      },
      empty: top.length === 0,
    };
  }, [stats.models, theme, totals.cost]);

  const costCell = (a: UsageAggregate) =>
    a.unpricedRequests >= a.requests && a.requests > 0 ? (
      <span className={styles.muted}>{t('usage_stats.unpriced')}</span>
    ) : (
      <span className={styles.cellStrong} title={exactCost(a.cost)}>
        {formatCost(a.cost)}
      </span>
    );

  const unitCostCell = (value: number | null, empty: string = t('usage_stats.unpriced')) => {
    return value === null ? (
      <span className={styles.muted}>{empty}</span>
    ) : (
      <span title={exactCost(value)}>{formatCost(value)}</span>
    );
  };

  const modelSort = useSort();
  const keySort = useSort();
  const credentialSort = useSort();
  const priced = (a: UsageAggregate) =>
    a.unpricedRequests >= a.requests && a.requests > 0 ? null : a.cost;
  const positive = (value: number) => (value > 0 ? value : null);

  const modelColumns: Column<UsageModelStat>[] = [
    { key: 'model', label: t('usage_stats.col_model'), text: true, value: (m) => m.model },
    { key: 'requests', label: t('usage_stats.col_requests'), value: (m) => m.requests },
    { key: 'success', label: t('usage_stats.col_success_rate'), value: successRate },
    { key: 'input', label: t('usage_stats.col_input'), value: inputTokens },
    { key: 'cached', label: t('usage_stats.col_cached'), value: (m) => m.tokens.cacheRead },
    { key: 'output', label: t('usage_stats.col_output'), value: (m) => m.tokens.output },
    { key: 'avgTokens', label: t('usage_stats.col_avg_tokens'), value: tokensPerRequest },
    { key: 'latency', label: t('usage_stats.col_latency'), value: (m) => positive(m.avgLatencyMs) },
    { key: 'speed', label: t('usage_stats.col_speed'), value: (m) => positive(m.outputTps) },
    { key: 'cost', label: t('usage_stats.col_cost'), value: priced },
    { key: 'avgCost', label: t('usage_stats.col_avg_cost'), value: costPerRequest },
    { key: 'unitCost', label: t('usage_stats.col_cost_per_m'), value: costPerMillionTokens },
  ];
  const keyName = (k: UsageApiKeyStat) =>
    labels.keyName(k.apiKeyId) || k.apiKey || t('usage_stats.none');
  const keyColumns: Column<UsageApiKeyStat>[] = [
    { key: 'key', label: t('usage_stats.col_key'), text: true, value: keyName },
    { key: 'requests', label: t('usage_stats.col_requests'), value: (k) => k.requests },
    { key: 'tokens', label: t('usage_stats.col_tokens'), value: (k) => k.tokens.total },
    { key: 'cost', label: t('usage_stats.col_cost'), value: priced },
  ];
  const quotaTargets = useMemo(
    () => collectCredentialQuotaTargets(stats.credentials, labels.quotaEntry),
    [labels.quotaEntry, stats.credentials]
  );
  const hasLoadedQuota = useMemo(
    () => quotaTargets.some((entry) => readCachedQuota(quotaStore, entry)?.status === 'success'),
    [quotaStore, quotaTargets]
  );
  const tickNow = useNow(hasLoadedQuota && nowMs === undefined);
  const effectiveNow = nowMs ?? tickNow;

  const credentialQuotas = useMemo(() => {
    const map = new Map<
      string,
      { entry: QuotaFileEntry | null; summary: CredentialQuotaSummary | null }
    >();
    for (const c of stats.credentials) {
      const entry = labels.quotaEntry?.(c.authIndex) ?? null;
      const summary = entry
        ? summarizeCredentialQuota(
            entry.type,
            readCachedQuota(quotaStore, entry),
            effectiveNow,
            entry.file.name
          )
        : null;
      map.set(c.authIndex, { entry, summary });
    }
    return map;
  }, [effectiveNow, labels, quotaStore, stats.credentials]);

  const modalTarget: CredentialQuotaModalTarget | null = useMemo(() => {
    if (!selectedQuotaKey) return null;
    const entry = labels.quotaEntry?.(selectedQuotaKey.authIndex) ?? null;
    if (!entry) return null;
    return {
      entry,
      credentialLabel: labels.credential(selectedQuotaKey.authIndex, selectedQuotaKey.source),
      provider: selectedQuotaKey.provider,
    };
  }, [labels, selectedQuotaKey]);

  const credentialName = (c: UsageCredentialStat) => labels.credential(c.authIndex, c.source);
  const quotaRemaining = (c: UsageCredentialStat) =>
    credentialQuotas.get(c.authIndex)?.summary?.remaining ?? null;
  const credentialColumns: Column<UsageCredentialStat>[] = [
    {
      key: 'credential',
      label: t('usage_stats.col_credential'),
      text: true,
      value: credentialName,
    },
    { key: 'requests', label: t('usage_stats.col_requests'), value: (c) => c.requests },
    { key: 'success', label: t('usage_stats.col_success_rate'), value: successRate },
    { key: 'cost', label: t('usage_stats.col_cost'), value: priced },
    { key: 'quota', label: t('usage_stats.col_quota'), value: quotaRemaining },
  ];
  const sortedModels = ranked(stats.models, modelColumns, modelSort.sort);
  const sortedKeys = ranked(stats.apiKeys, keyColumns, keySort.sort);
  const sortedCredentials = ranked(stats.credentials, credentialColumns, credentialSort.sort);

  // Raw numbers for spreadsheets; an unpriced cost stays empty rather than 0.
  const round = (value: number | null, digits: number) =>
    value === null ? '' : Number(value.toFixed(digits));
  const aggregateFields: CsvField<UsageAggregate>[] = [
    [t('usage_stats.col_requests'), (a) => a.requests],
    [t('usage_stats.series_failed'), (a) => a.failed],
    [`${t('usage_stats.col_success_rate')} (%)`, (a) => round(successRate(a), 2)],
    [t('usage_stats.col_input'), inputTokens],
    [t('usage_stats.series_cache_read'), (a) => a.tokens.cacheRead],
    [t('usage_stats.series_cache_write'), (a) => a.tokens.cacheWrite],
    [t('usage_stats.col_output'), (a) => a.tokens.output],
    [t('usage_stats.series_reasoning'), (a) => a.tokens.reasoning],
    [t('usage_stats.col_tokens'), (a) => a.tokens.total],
    [t('usage_stats.col_avg_tokens'), (a) => round(tokensPerRequest(a), 1)],
    [`${t('usage_stats.col_latency')} (ms)`, (a) => Math.round(a.avgLatencyMs)],
    [`${t('usage_stats.card_ttft_title')} (ms)`, (a) => Math.round(a.avgTtftMs)],
    [`${t('usage_stats.col_speed')} (t/s)`, (a) => round(a.outputTps, 1)],
    [`${t('usage_stats.col_cost')} (USD)`, (a) => round(priced(a), 6)],
    [`${t('usage_stats.col_avg_cost')} (USD)`, (a) => round(costPerRequest(a), 6)],
    [`${t('usage_stats.col_cost_per_m')} (USD)`, (a) => round(costPerMillionTokens(a), 6)],
  ];
  const downloadCsv = <T,>(name: string, fields: CsvField<T>[], rows: { row: T }[]) => {
    const csv = toCsv([
      fields.map(([label]) => label),
      ...rows.map(({ row }) => fields.map(([, value]) => value(row))),
    ]);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadBlob({
      filename: `usage-${name}-${stamp}.csv`,
      blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    });
  };
  const exportButton = (onClick: () => void, empty: boolean) => (
    <Button variant="secondary" size="sm" onClick={onClick} disabled={empty}>
      {t('usage_stats.export_csv')}
    </Button>
  );

  const rowProps = (filter: EventsFilter, label: string) => ({
    className: styles.clickableRow,
    tabIndex: 0,
    title: t('usage_stats.open_events'),
    'aria-label': t('usage_stats.open_events_for', { name: label }),
    onClick: () => onOpenEvents(filter),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpenEvents(filter);
      }
    },
  });

  return (
    <>
      <section
        className={`${styles.cards} ${styles.cardsFour}`}
        aria-label={t('usage_stats.summary_label')}
      >
        <StatCard
          accent="requests"
          label={t('usage_stats.card_requests')}
          value={<CountUp value={totals.requests} format={formatCompact} />}
          valueTitle={exactCount(totals.requests)}
          change={prev ? changePercent(totals.requests, prev.requests) : undefined}
          spark={stats.series.map((p) => p.requests)}
          sub={
            <>
              <span className={styles.legendDot} style={{ background: theme.success }} />
              {t('usage_stats.card_succeeded', {
                count: formatCompact(totals.requests - totals.failed),
              })}
              <span className={styles.legendDot} style={{ background: theme.failure }} />
              {t('usage_stats.card_failed', { count: formatCompact(totals.failed) })}
            </>
          }
        />
        <StatCard
          accent="success"
          label={t('usage_stats.card_success_rate')}
          value={
            rate === null ? formatPercent(null) : <CountUp value={rate} format={formatPercent} />
          }
          change={rate !== null && prevRate !== null ? rate - prevRate : undefined}
          changeUnit="pt"
          spark={stats.series.map((p) => successRate(p) ?? 0)}
        />
        <StatCard
          accent="tokens"
          label={t('usage_stats.card_tokens')}
          value={<CountUp value={totals.tokens.total} format={formatCompact} />}
          valueTitle={exactCount(totals.tokens.total)}
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
          value={<CountUp value={totals.cost} format={formatCost} />}
          valueTitle={exactCost(totals.cost)}
          change={prev ? changePercent(totals.cost, prev.cost) : undefined}
          goodWhenUp={false}
          spark={stats.series.map((p) => p.cost)}
          sub={
            totals.unpricedRequests > 0
              ? t('usage_stats.card_unpriced', { count: formatCompact(totals.unpricedRequests) })
              : t('usage_stats.card_cost_sub')
          }
        />
        <StatCard
          accent="cache"
          label={t('usage_stats.card_cache_hit')}
          value={
            cacheRate === null ? (
              formatPercent(null)
            ) : (
              <CountUp value={cacheRate} format={formatPercent} />
            )
          }
          spark={stats.series.map((p) => cacheHitRate(p) ?? 0)}
          sub={
            <>
              {t('usage_stats.card_cache_hit_sub', {
                cached: formatCompact(totals.tokens.cacheRead),
              })}
              {saved > 0 && (
                <span title={t('usage_stats.card_cache_saved_hint')}>
                  {' · '}
                  {t('usage_stats.card_cache_saved', { value: formatCost(saved) })}
                </span>
              )}
            </>
          }
        />
        <StatCard
          accent="latency"
          label={t('usage_stats.card_latency')}
          value={<CountUp value={totals.avgLatencyMs} format={formatMs} />}
          change={
            prev && prev.avgLatencyMs > 0
              ? changePercent(totals.avgLatencyMs, prev.avgLatencyMs)
              : undefined
          }
          goodWhenUp={false}
          spark={stats.series.map((p) => p.avgLatencyMs)}
          sub={t('usage_stats.card_latency_sub')}
        />
        <StatCard
          accent="ttft"
          label={t('usage_stats.card_ttft_title')}
          value={<CountUp value={totals.avgTtftMs} format={formatMs} />}
          change={
            prev && prev.avgTtftMs > 0 && totals.avgTtftMs > 0
              ? changePercent(totals.avgTtftMs, prev.avgTtftMs)
              : undefined
          }
          goodWhenUp={false}
          spark={stats.series.map((p) => p.avgTtftMs)}
          sub={t('usage_stats.card_ttft_sub')}
        />
        <StatCard
          accent="speed"
          label={t('usage_stats.card_speed')}
          value={<CountUp value={totals.outputTps} format={formatTps} />}
          change={
            prev && prev.outputTps > 0 && totals.outputTps > 0
              ? changePercent(totals.outputTps, prev.outputTps)
              : undefined
          }
          spark={stats.series.map((p) => p.outputTps)}
          sub={t('usage_stats.card_speed_sub')}
        />
      </section>

      <section className={styles.panel} data-reveal="">
        <div className={styles.panelHeader}>
          <PanelHeading
            title={t('usage_stats.trend_title')}
            desc={`${t('usage_stats.trend_desc')} ${t('usage_stats.trend_drill_hint')}`}
          />
          <div className={styles.panelActions}>
            <div className={styles.segmented}>
              <button
                type="button"
                className={comparePrevious ? styles.segmentActive : styles.segment}
                aria-pressed={comparePrevious}
                disabled={metric === 'combined'}
                title={t('usage_stats.compare_previous_hint')}
                onClick={toggleComparePrevious}
              >
                {t('usage_stats.compare_previous')}
              </button>
            </div>
            <div
              className={styles.segmented}
              role="group"
              aria-label={t('usage_stats.metric_label')}
            >
              {TREND_METRICS.map((value) => (
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
        </div>
        <div
          className={styles.chartBox}
          role="img"
          aria-label={t('usage_stats.chart_label', { metric: t(`usage_stats.metric_${metric}`) })}
        >
          {trend.kind === 'bar' ? (
            <Chart type="bar" data={trend.data} options={trend.options} />
          ) : (
            <Chart type="line" data={trend.data} options={trend.options} />
          )}
        </div>
      </section>

      <div className={styles.split}>
        <section className={styles.panel} data-reveal="">
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
        <section className={styles.panel} data-reveal="">
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

      <section className={styles.panel} data-reveal="">
        <div className={styles.panelHeader}>
          <PanelHeading title={t('usage_stats.models_title')} desc={t('usage_stats.models_desc')} />
          {exportButton(
            () =>
              downloadCsv(
                'models',
                [
                  [t('usage_stats.col_model'), (m: UsageModelStat) => m.model],
                  [t('usage_stats.col_provider'), (m: UsageModelStat) => m.provider],
                  ...aggregateFields,
                ],
                sortedModels
              ),
            stats.models.length === 0
          )}
        </div>
        {stats.models.length === 0 ? (
          <p className={styles.muted}>{t('usage_stats.no_data')}</p>
        ) : (
          <Table className={styles.table}>
            <TableHeader>
              <TableRow>{sortHeads(modelColumns, modelSort)}</TableRow>
            </TableHeader>
            <TableBody>
              {sortedModels.map(({ row: m, color }, index) => (
                <TableRow
                  key={`${m.provider}:${m.model}`}
                  {...rowProps({ model: m.model, provider: m.provider }, m.model)}
                >
                  <TableCell>
                    <RankName
                      rank={index + 1}
                      color={color}
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
                    <Share value={m.requests} total={totals.requests} color={color} />
                  </TableCell>
                  <TableCell alignRight>
                    <Rate value={successRate(m)} />
                  </TableCell>
                  <TableCell alignRight>
                    <Compact value={inputTokens(m)} />
                  </TableCell>
                  <TableCell alignRight>
                    <Compact value={m.tokens.cacheRead} />
                  </TableCell>
                  <TableCell alignRight>
                    <Compact value={m.tokens.output} />
                  </TableCell>
                  <TableCell alignRight>
                    <Compact value={tokensPerRequest(m)} />
                  </TableCell>
                  <TableCell alignRight>{formatMs(m.avgLatencyMs)}</TableCell>
                  <TableCell alignRight>{formatTps(m.outputTps)}</TableCell>
                  <TableCell alignRight>{costCell(m)}</TableCell>
                  <TableCell alignRight>{unitCostCell(costPerRequest(m))}</TableCell>
                  <TableCell alignRight>
                    {unitCostCell(
                      costPerMillionTokens(m),
                      priced(m) === null ? t('usage_stats.unpriced') : '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <div className={styles.split}>
        <section className={styles.panel} data-reveal="">
          <div className={styles.panelHeader}>
            <PanelHeading title={t('usage_stats.keys_title')} desc={t('usage_stats.keys_desc')} />
            {exportButton(
              () =>
                downloadCsv(
                  'keys',
                  [
                    [t('usage_stats.col_key'), keyName],
                    [t('usage_stats.col_key_masked'), (k: UsageApiKeyStat) => k.apiKey],
                    ...aggregateFields,
                  ],
                  sortedKeys
                ),
              stats.apiKeys.length === 0
            )}
          </div>
          {stats.apiKeys.length === 0 ? (
            <p className={styles.muted}>{t('usage_stats.no_data')}</p>
          ) : (
            <Table className={styles.table}>
              <TableHeader>
                <TableRow>{sortHeads(keyColumns, keySort)}</TableRow>
              </TableHeader>
              <TableBody>
                {sortedKeys.map(({ row: k, color }, index) => (
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
                        color={color}
                        name={<KeyLabel name={labels.keyName(k.apiKeyId)} masked={k.apiKey} />}
                      />
                    </TableCell>
                    <TableCell alignRight>
                      <Share value={k.requests} total={totals.requests} color={color} />
                    </TableCell>
                    <TableCell alignRight>
                      <Compact value={k.tokens.total} />
                    </TableCell>
                    <TableCell alignRight>{costCell(k)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <section className={styles.panel} data-reveal="">
          <div className={styles.panelHeader}>
            <PanelHeading
              title={t('usage_stats.credentials_title')}
              desc={t('usage_stats.credentials_desc')}
            />
            <div className={styles.panelActions}>
              <Button
                variant="secondary"
                size="sm"
                loading={batchLoading}
                disabled={!isConnected || quotaTargets.length === 0}
                onClick={() => void loadQuota(quotaTargets)}
              >
                <span className={styles.iconLabel}>
                  {!batchLoading && <IconRefreshCw size={14} />}
                  {t('usage_stats.quota_load')}
                </span>
              </Button>
              {exportButton(
                () =>
                  downloadCsv(
                    'credentials',
                    [
                      [t('usage_stats.col_credential'), credentialName],
                      [t('usage_stats.col_provider'), (c: UsageCredentialStat) => c.provider],
                      ...aggregateFields,
                      [
                        `${t('usage_stats.col_quota')} (%)`,
                        (c: UsageCredentialStat) => round(quotaRemaining(c), 1),
                      ],
                    ],
                    sortedCredentials
                  ),
                stats.credentials.length === 0
              )}
            </div>
          </div>
          {stats.credentials.length === 0 ? (
            <p className={styles.muted}>{t('usage_stats.no_data')}</p>
          ) : (
            <Table className={styles.table}>
              <TableHeader>
                <TableRow>{sortHeads(credentialColumns, credentialSort)}</TableRow>
              </TableHeader>
              <TableBody>
                {sortedCredentials.map(({ row: c, color }, index) => {
                  const credLabel = labels.credential(c.authIndex, c.source);
                  const quotaInfo = credentialQuotas.get(c.authIndex);
                  return (
                    <TableRow
                      key={c.authIndex || 'none'}
                      {...rowProps({ auth_index: c.authIndex }, credLabel)}
                    >
                      <TableCell>
                        <RankName
                          rank={index + 1}
                          color={color}
                          name={credLabel}
                          sub={<ProviderBadge provider={c.provider} />}
                        />
                      </TableCell>
                      <TableCell alignRight>
                        <Share value={c.requests} total={totals.requests} color={color} />
                      </TableCell>
                      <TableCell alignRight>
                        <Rate value={successRate(c)} />
                      </TableCell>
                      <TableCell alignRight>{costCell(c)}</TableCell>
                      <TableCell alignRight>
                        <CredentialQuotaCell
                          entry={quotaInfo?.entry ?? null}
                          summary={quotaInfo?.summary ?? null}
                          credentialLabel={credLabel}
                          nowMs={effectiveNow}
                          onOpen={() =>
                            setSelectedQuotaKey({
                              authIndex: c.authIndex,
                              source: c.source,
                              provider: c.provider,
                            })
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </section>
      </div>
      <CredentialQuotaModal
        target={modalTarget}
        disableControls={!isConnected}
        onClose={() => setSelectedQuotaKey(null)}
      />
    </>
  );
}
