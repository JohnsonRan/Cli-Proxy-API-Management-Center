import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { EventDetailModal } from '../components/EventDetailModal';
import { PanelHeading } from '../components/PanelBits';
import { formatCompact, formatCost, formatMs } from '../format';
import {
  EVENT_COLUMNS,
  readEventColumns,
  toEventsQuery,
  type EventColumn,
  type EventsFilter,
} from '../logic';
import type { UsageWindow } from '../UsagePage';
import styles from '../UsagePage.module.scss';

const PAGE_SIZE = 50;
const COLUMNS_STORAGE_KEY = 'cpamc-usage-event-columns';

interface EventsTabProps {
  usageWindow: UsageWindow;
  stats: UsageStats;
  filter: EventsFilter;
  onFilterChange: (filter: EventsFilter) => void;
  credentialLabel: (authIndex: string) => string;
}

export function EventsTab({
  usageWindow,
  stats,
  filter,
  onFilterChange,
  credentialLabel,
}: EventsTabProps) {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [events, setEvents] = useState<UsageEvent[]>([]);
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
  const query = useMemo(() => toEventsQuery(usageWindow, filter), [usageWindow, filter]);

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

  // `stats` changes on every refresh, so the first page follows the header refresh too.
  useEffect(() => {
    void load(0);
    return () => {
      requestRef.current += 1;
    };
  }, [load, stats]);

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

  const all = { value: '', label: t('usage_stats.filter_all') };
  const filterOptions = {
    model: [all, ...unique(stats.models.map((m) => m.model)).map((v) => ({ value: v, label: v }))],
    provider: [
      all,
      ...unique(stats.models.map((m) => m.provider)).map((v) => ({ value: v, label: v })),
    ],
    api_key_id: [
      all,
      ...stats.apiKeys.map((k) => ({
        value: k.apiKeyId,
        label: k.apiKey || t('usage_stats.none'),
      })),
    ],
    auth_index: [
      all,
      ...stats.credentials.map((c) => ({
        value: c.authIndex,
        label: credentialLabel(c.authIndex),
      })),
    ],
    result: [
      all,
      { value: 'success', label: t('usage_stats.result_success') },
      { value: 'failed', label: t('usage_stats.result_failed') },
    ],
  };
  const filterKeys = Object.keys(filterOptions) as (keyof EventsFilter)[];
  const activeFilters = filterKeys.filter((k) => filter[k]).length;

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

  const cell = (column: EventColumn, e: UsageEvent) => {
    switch (column) {
      case 'time':
        return (
          <TableCell className={styles.mono}>
            {timeFormatter.format(new Date(e.timestamp))}
          </TableCell>
        );
      case 'model':
        return (
          <TableCell className={styles.mono}>
            {e.model}
            {e.stream && <span className={styles.badge}>{t('usage_stats.stream')}</span>}
          </TableCell>
        );
      case 'provider':
        return <TableCell>{e.provider}</TableCell>;
      case 'credential':
        return <TableCell>{credentialLabel(e.authIndex)}</TableCell>;
      case 'key':
        return <TableCell className={styles.mono}>{e.apiKey || t('usage_stats.none')}</TableCell>;
      case 'status':
        return (
          <TableCell alignRight>
            <span className={e.failed ? styles.statusFailed : styles.statusOk}>
              {e.statusCode || (e.failed ? t('usage_stats.failed') : 'OK')}
            </span>
          </TableCell>
        );
      case 'latency':
        return <TableCell alignRight>{formatMs(e.latencyMs)}</TableCell>;
      case 'ttft':
        return <TableCell alignRight>{formatMs(e.ttftMs)}</TableCell>;
      case 'input':
        return (
          <TableCell alignRight>
            {formatCompact(e.tokens.inputUncached + e.tokens.cacheRead + e.tokens.cacheWrite)}
          </TableCell>
        );
      case 'cached':
        return <TableCell alignRight>{formatCompact(e.tokens.cacheRead)}</TableCell>;
      case 'output':
        return <TableCell alignRight>{formatCompact(e.tokens.output)}</TableCell>;
      case 'cost':
        return (
          <TableCell alignRight>
            {e.priced ? (
              formatCost(e.cost)
            ) : (
              <span className={styles.muted}>{t('usage_stats.unpriced')}</span>
            )}
          </TableCell>
        );
      case 'tier':
        return (
          <TableCell>{[e.serviceTier, e.reasoningEffort].filter(Boolean).join(' · ')}</TableCell>
        );
      case 'endpoint':
        return <TableCell className={styles.mono}>{e.endpoint}</TableCell>;
      case 'client':
        return <TableCell>{e.clientIp}</TableCell>;
    }
  };

  const numeric = new Set<EventColumn>([
    'status',
    'latency',
    'ttft',
    'input',
    'cached',
    'output',
    'cost',
  ]);

  return (
    <section className={styles.panel}>
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

      <div className={styles.filters}>
        {filterKeys.map((key) => (
          <label key={key} className={styles.filterField}>
            <span className={styles.filterLabel}>{t(`usage_stats.filter_${key}`)}</span>
            <Select
              value={filter[key] ?? ''}
              options={filterOptions[key]}
              onChange={(value) => onFilterChange({ ...filter, [key]: value || undefined })}
              ariaLabel={t(`usage_stats.filter_${key}`)}
              size="sm"
              fullWidth
            />
          </label>
        ))}
        {activeFilters > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onFilterChange({})}>
            {t('usage_stats.clear_filters')}
          </Button>
        )}
      </div>

      {events.length === 0 && !loading ? (
        <p className={styles.muted}>{t('usage_stats.events_empty')}</p>
      ) : (
        <Table className={styles.table}>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column} alignRight={numeric.has(column)}>
                  {t(`usage_stats.column_${column}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((e) => (
              <TableRow
                key={e.id}
                className={styles.clickableRow}
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
      <EventDetailModal
        event={selected}
        credentialLabel={credentialLabel}
        onClose={() => setSelected(null)}
      />
    </section>
  );
}

const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
