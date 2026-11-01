import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { usageStoreApi, type UsageEvent, type UsageStats } from '@/services/api/usageStore';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
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
  EventClientCell,
  EventCostCell,
  EventGroupStatusCell,
  EventLatencyCell,
  EventModelCell,
  EventRouteCell,
  EventStatusCell,
  EventTimeCell,
  EventTokensCell,
} from '../components/EventCells';
import { PanelHeading, Rate } from '../components/PanelBits';
import {
  exactCost,
  exactCount,
  formatCompact,
  formatCost,
  formatMs,
  formatTps,
  successRate,
} from '../format';
import type { UsageLabels } from '../hooks/useUsageLabels';
import {
  EVENT_COLUMNS,
  groupWebsocketEvents,
  toEventsQuery,
  toggleInSet,
  type EventColumn,
  type UsageGlobalFilter,
} from '../logic';
import type { UsageWindow } from '../UsagePage';
import styles from '../UsagePage.module.scss';

const PAGE_SIZE = 50;
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
    title?: string;
    color: string;
    sub?: string;
  }[] = [
    {
      icon: 'requests',
      label: t('usage_stats.card_requests'),
      value: <CountUp value={totals.requests} format={formatCompact} />,
      title: exactCount(totals.requests),
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
      title: exactCount(totals.tokens.total),
      color: METRIC_ACCENTS.tokens,
    },
    {
      icon: 'cost',
      label: t('usage_stats.card_cost'),
      value: <CountUp value={totals.cost} format={formatCost} />,
      title: exactCost(totals.cost),
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
      color: METRIC_ACCENTS.latency,
    });
  }
  return (
    <div className={styles.summaryStrip} aria-label={t('usage_stats.events_summary')}>
      {items.map((item) => (
        <Card key={item.icon} className={styles.summaryItem}>
          <div className={styles.summaryTop}>
            <span className={styles.statLabelGroup}>
              <span
                className={styles.metricDot}
                style={{ backgroundColor: item.color }}
                aria-hidden="true"
              />
              <span className={styles.summaryLabel}>{item.label}</span>
            </span>
            <span className={styles.summaryGlyph} aria-hidden="true">
              <MetricIcon name={item.icon} />
            </span>
          </div>
          <span className={styles.summaryValue} title={item.title}>
            {item.value}
          </span>
          {item.sub && <span className={styles.summarySub}>{item.sub}</span>}
        </Card>
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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const items = useMemo(() => groupWebsocketEvents(events), [events]);
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
        risk: query.risk,
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

  const resultOptions = useMemo(
    () => [
      { value: '', label: t('usage_stats.filter_all') },
      { value: 'success', label: t('usage_stats.result_success') },
      { value: 'failed', label: t('usage_stats.result_failed') },
      { value: 'substituted', label: t('usage_stats.result_substituted') },
      { value: 'risk', label: t('usage_stats.result_risk') },
    ],
    [t]
  );

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    [i18n.language]
  );
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: 'numeric', day: 'numeric' }),
    [i18n.language]
  );

  const cell = (column: EventColumn, e: UsageEvent) => {
    switch (column) {
      case 'time':
        return (
          <TableCell>
            <EventTimeCell
              timestamp={e.timestamp}
              timeFormatter={timeFormatter}
              dateFormatter={dateFormatter}
            />
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
            <EventLatencyCell event={e} />
          </TableCell>
        );
      case 'cost':
        return (
          <TableCell alignRight>
            <EventCostCell event={e} />
          </TableCell>
        );
      case 'client':
        return (
          <TableCell>
            <EventClientCell event={e} />
          </TableCell>
        );
    }
  };

  const eventRow = (e: UsageEvent, child = false) => (
    <TableRow
      key={e.id}
      className={[
        styles.clickableRow,
        e.failed ? styles.failedRow : '',
        child ? styles.groupChildRow : '',
      ]
        .filter(Boolean)
        .join(' ')}
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
      {EVENT_COLUMNS.map((column) => (
        <Fragment key={column}>{cell(column, e)}</Fragment>
      ))}
    </TableRow>
  );

  return (
    <section className={styles.panel} data-reveal="">
      <div className={styles.panelHeader}>
        <PanelHeading
          title={t('usage_stats.events_title')}
          desc={t('usage_stats.events_subtitle')}
        />
        <div className={styles.toolbarActions}>
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
              {EVENT_COLUMNS.map((column) => (
                <TableHead key={column} alignRight={NUMERIC_COLUMNS.has(column)}>
                  {t(`usage_stats.column_${column}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              if (item.kind === 'event') return eventRow(item.event);
              const { group } = item;
              const open = expanded.has(group.requestId);
              const toggle = () => setExpanded((prev) => toggleInSet(prev, group.requestId));
              return (
                <Fragment key={`ws-${group.requestId}`}>
                  <TableRow
                    className={
                      group.summary.failed
                        ? `${styles.clickableRow} ${styles.failedRow}`
                        : styles.clickableRow
                    }
                    tabIndex={0}
                    aria-expanded={open}
                    aria-label={t('usage_stats.ws_group_toggle')}
                    onClick={toggle}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggle();
                      }
                    }}
                  >
                    {EVENT_COLUMNS.map((column) => (
                      <Fragment key={column}>
                        {column === 'status' ? (
                          <TableCell>
                            <EventGroupStatusCell group={group} live={false} expanded={open} />
                          </TableCell>
                        ) : (
                          cell(column, group.summary)
                        )}
                      </Fragment>
                    ))}
                  </TableRow>
                  {open && group.events.map((e) => eventRow(e, true))}
                </Fragment>
              );
            })}
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
