import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { usageStoreApi, type UsageEvent, type UsageStats } from '@/services/api/usageStore';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { useNotificationStore } from '@/stores';
import { downloadBlob } from '@/utils/download';
import { METRIC_ACCENTS } from '../charts';
import { EventDetailModal } from '../components/EventDetailModal';
import { MetricIcon, type MetricIconName } from '../components/MetricIcon';
import { CountUp } from '../components/Motion';
import {
  EventLatencyCell,
  EventModelCell,
  EventRouteCell,
  EventStatusCell,
  EventTokensCell,
} from '../components/EventCells';
import { PanelHeading, Rate } from '../components/PanelBits';
import { formatCompact, formatCost, formatMs, formatTps, successRate } from '../format';
import type { UsageLabels } from '../hooks/useUsageLabels';
import {
  EVENT_COLUMNS,
  readEventColumns,
  toEventsQuery,
  type EventColumn,
  type UsageGlobalFilter,
} from '../logic';
import type { UsageWindow } from '../UsagePage';
import styles from '../UsagePage.module.scss';

const PAGE_SIZE = 50;
const COLUMNS_STORAGE_KEY = 'cpamc-usage-event-columns:v4';
const NUMERIC_COLUMNS = new Set<EventColumn>(['tokens', 'latency', 'cost']);

interface EventsTabProps {
  usageWindow: UsageWindow;
  stats: UsageStats;
  globalFilter: UsageGlobalFilter;
  resultFilter?: string;
  onResultFilterChange: (result?: string) => void;
  onAddFilter: (
    dimension: 'model' | 'provider' | 'api_key_id' | 'auth_index',
    value: string
  ) => void;
  labels: UsageLabels;
}

/** Inline summary of the requests matching the current filter. */
function FilterSummary({
  summary,
  showResultHint,
}: {
  summary: UsageStats | null;
  showResultHint: boolean;
}) {
  const { t } = useTranslation();
  if (!summary) return <div className={styles.summaryStrip} aria-hidden="true" />;
  const totals = summary.totals;
  const items: {
    icon: MetricIconName;
    label: string;
    value: ReactNode;
    color: string;
    sub?: string;
  }[] = [
    {
      icon: 'requests',
      label: t('usage_stats.card_requests'),
      value: <CountUp value={totals.requests} format={formatCompact} />,
      color: METRIC_ACCENTS.requests,
    },
    {
      icon: 'success',
      label: t('usage_stats.card_success_rate'),
      value: <Rate value={successRate(totals)} />,
      color: METRIC_ACCENTS.success,
    },
    {
      icon: 'failed',
      label: t('usage_stats.card_failed_short'),
      value: <CountUp value={totals.failed} format={formatCompact} />,
      color: 'var(--viz-failure)',
    },
    {
      icon: 'tokens',
      label: t('usage_stats.card_tokens'),
      value: <CountUp value={totals.tokens.total} format={formatCompact} />,
      color: METRIC_ACCENTS.tokens,
    },
    {
      icon: 'cost',
      label: t('usage_stats.card_cost'),
      value: <CountUp value={totals.cost} format={formatCost} />,
      color: METRIC_ACCENTS.cost,
    },
    {
      icon: 'latency',
      label: t('usage_stats.card_latency'),
      value: <CountUp value={totals.avgLatencyMs} format={formatMs} />,
      color: METRIC_ACCENTS.latency,
      sub: t('usage_stats.card_ttft', { value: formatMs(totals.avgTtftMs) }),
    },
    {
      icon: 'speed',
      label: t('usage_stats.card_speed'),
      value: <CountUp value={totals.outputTps} format={formatTps} />,
      color: METRIC_ACCENTS.speed,
    },
  ];
  if (totals.substituted > 0) {
    items.push({
      icon: 'substituted',
      label: t('usage_stats.card_substituted'),
      value: <CountUp value={totals.substituted} format={formatCompact} />,
      color: '#d97706',
    });
  }
  return (
    <div className={styles.summaryStrip} aria-label={t('usage_stats.events_summary')}>
      {items.map((item) => (
        <div
          key={item.icon}
          className={styles.summaryItem}
          style={{ '--accent': item.color } as CSSProperties}
        >
          <div className={styles.summaryTop}>
            <span className={styles.summaryLabel}>{item.label}</span>
            <span className={styles.summaryIcon}>
              <MetricIcon name={item.icon} />
            </span>
          </div>
          <span className={styles.summaryValue}>{item.value}</span>
          {item.sub && <span className={styles.summarySub}>{item.sub}</span>}
        </div>
      ))}
      {showResultHint && (
        <p className={styles.summaryNote}>{t('usage_stats.events_summary_hint')}</p>
      )}
    </div>
  );
}

export function EventsTab({
  usageWindow,
  stats,
  globalFilter,
  resultFilter,
  onResultFilterChange,
  onAddFilter,
  labels,
}: EventsTabProps) {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [summary, setSummary] = useState<UsageStats | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<'' | 'csv' | 'json'>('');
  const [selected, setSelected] = useState<UsageEvent | null>(null);
  const [columns, setColumns] = useState<EventColumn[]>(() =>
    readEventColumns(
      typeof localStorage === 'undefined' ? null : localStorage.getItem(COLUMNS_STORAGE_KEY)
    )
  );
  const [columnsOpen, setColumnsOpen] = useState(false);
  const requestRef = useRef(0);
  const summaryRef = useRef(0);
  const query = useMemo(
    () => toEventsQuery(usageWindow, globalFilter, resultFilter),
    [usageWindow, globalFilter, resultFilter]
  );

  const load = useCallback(
    async (before: number) => {
      const requestId = ++requestRef.current;
      setLoading(true);
      try {
        const page = await usageStoreApi.getEvents({ ...query, before, limit: PAGE_SIZE });
        if (requestId !== requestRef.current) return;
        setEvents((prev) => (before ? [...prev, ...page.events] : page.events));
        setDone(page.events.length < PAGE_SIZE);
      } catch (err: unknown) {
        if (requestId !== requestRef.current) return;
        showNotification(
          err instanceof Error ? err.message : t('notification.refresh_failed'),
          'error'
        );
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    },
    [query, showNotification, t]
  );

  // Reload when query, stats or globalFilter changes.
  useEffect(() => {
    void load(0);
    const summaryId = ++summaryRef.current;
    usageStoreApi
      .getStats(usageWindow.from, usageWindow.to, usageWindow.tzOffset, {
        model: globalFilter.models,
        provider: globalFilter.providers,
        apiKeyId: globalFilter.apiKeyIds,
        authIndex: globalFilter.authIndexes,
        failed: query.failed,
        substituted: query.substituted,
      })
      .then((next) => {
        if (summaryId === summaryRef.current) setSummary(next);
      })
      .catch(() => {
        if (summaryId === summaryRef.current) setSummary(null);
      });
    return () => {
      requestRef.current += 1;
      summaryRef.current += 1;
    };
  }, [load, query, stats, usageWindow, globalFilter]);

  const exportAs = async (format: 'csv' | 'json') => {
    setExporting(format);
    try {
      const blob = await usageStoreApi.exportEvents(query, format);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      downloadBlob({ filename: `usage-events-${stamp}.${format}`, blob });
    } catch (err: unknown) {
      showNotification(
        err instanceof Error ? err.message : t('usage_stats.export_failed'),
        'error'
      );
    } finally {
      setExporting('');
    }
  };

  const toggleColumn = (column: EventColumn, on: boolean) => {
    const next = EVENT_COLUMNS.filter((c) => (c === column ? on : columns.includes(c)));
    if (next.length === 0) return;
    setColumns(next);
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(next));
  };

  const resultOptions = useMemo(
    () => [
      { value: '', label: t('usage_stats.filter_all') },
      { value: 'success', label: t('usage_stats.result_success') },
      { value: 'failed', label: t('usage_stats.result_failed') },
      { value: 'substituted', label: t('usage_stats.result_substituted') },
    ],
    [t]
  );

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    [i18n.language]
  );

  // A request is "slow" when it takes over twice the average of the matching requests.
  const slowAfterMs = (summary?.totals.avgLatencyMs ?? 0) * 2;

  const cell = (column: EventColumn, e: UsageEvent) => {
    switch (column) {
      case 'time':
        return (
          <TableCell className={styles.mono}>
            {timeFormatter.format(new Date(e.timestamp))}
          </TableCell>
        );
      case 'status':
        return (
          <TableCell>
            <EventStatusCell event={e} onResult={onResultFilterChange} />
          </TableCell>
        );
      case 'model':
        return (
          <TableCell>
            <EventModelCell event={e} onAdd={onAddFilter} />
          </TableCell>
        );
      case 'route':
        return (
          <TableCell>
            <EventRouteCell event={e} labels={labels} onAdd={onAddFilter} />
          </TableCell>
        );
      case 'tokens':
        return (
          <TableCell alignRight>
            <EventTokensCell event={e} />
          </TableCell>
        );
      case 'latency':
        return (
          <TableCell alignRight>
            <EventLatencyCell event={e} slowAfterMs={slowAfterMs} />
          </TableCell>
        );
      case 'cost':
        return (
          <TableCell alignRight>
            {e.priced ? (
              <span className={styles.cellStrong}>{formatCost(e.cost)}</span>
            ) : (
              <span className={styles.muted}>{t('usage_stats.unpriced')}</span>
            )}
          </TableCell>
        );
      case 'client':
        return (
          <TableCell>
            <span className={styles.rankText}>
              <span className={styles.mono}>{e.clientIp || '—'}</span>
              {e.userAgent && (
                <span className={styles.endpointSub} title={e.userAgent}>
                  {e.userAgent}
                </span>
              )}
            </span>
          </TableCell>
        );
    }
  };

  return (
    <section className={styles.panel} data-reveal="">
      <div className={styles.panelHeader}>
        <PanelHeading
          title={t('usage_stats.events_title')}
          desc={t('usage_stats.events_subtitle')}
        />
        <div className={styles.toolbarActions}>
          <div className={styles.popoverWrap}>
            <Button
              variant="secondary"
              size="sm"
              aria-expanded={columnsOpen}
              onClick={() => setColumnsOpen((open) => !open)}
            >
              {t('usage_stats.columns')}
            </Button>
            {columnsOpen && (
              <div className={styles.popover} role="group" aria-label={t('usage_stats.columns')}>
                {EVENT_COLUMNS.map((column) => (
                  <SelectionCheckbox
                    key={column}
                    checked={columns.includes(column)}
                    onChange={(on) => toggleColumn(column, on)}
                    label={t(`usage_stats.column_${column}`)}
                    ariaLabel={t(`usage_stats.column_${column}`)}
                  />
                ))}
              </div>
            )}
          </div>
          <Button
            variant="secondary"
            size="sm"
            loading={exporting === 'csv'}
            onClick={() => void exportAs('csv')}
          >
            {t('usage_stats.export_csv')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={exporting === 'json'}
            onClick={() => void exportAs('json')}
          >
            {t('usage_stats.export_json')}
          </Button>
        </div>
      </div>

      <div className={styles.resultFilterRow}>
        <label className={styles.resultFilterField}>
          <span className={styles.filterLabel}>{t('usage_stats.filter_result')}</span>
          <Select
            value={resultFilter ?? ''}
            options={resultOptions}
            onChange={(value) => onResultFilterChange(value || undefined)}
            ariaLabel={t('usage_stats.filter_result')}
            size="sm"
            fullWidth
          />
        </label>
        {resultFilter && (
          <Button variant="ghost" size="sm" onClick={() => onResultFilterChange(undefined)}>
            {t('usage_stats.clear_filters')}
          </Button>
        )}
      </div>

      <FilterSummary summary={summary} showResultHint={Boolean(summary?.partial)} />

      {events.length === 0 && !loading ? (
        <p className={styles.muted}>{t('usage_stats.events_empty')}</p>
      ) : (
        <Table className={styles.table}>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column} alignRight={NUMERIC_COLUMNS.has(column)}>
                  {t(`usage_stats.column_${column}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((e) => (
              <TableRow
                key={e.id}
                className={
                  e.failed ? `${styles.clickableRow} ${styles.failedRow}` : styles.clickableRow
                }
                tabIndex={0}
                aria-label={t('usage_stats.open_detail')}
                onClick={() => setSelected(e)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelected(e);
                  }
                }}
              >
                {columns.map((column) => (
                  <Fragment key={column}>{cell(column, e)}</Fragment>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div className={styles.loadMore}>
        <span className={styles.muted}>
          {t('usage_stats.events_loaded', { count: events.length })}
        </span>
        {!done && events.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            loading={loading}
            onClick={() => void load(events[events.length - 1].id)}
          >
            {t('usage_stats.load_more')}
          </Button>
        )}
      </div>
      <EventDetailModal event={selected} labels={labels} onClose={() => setSelected(null)} />
    </section>
  );
}
