/**
 * Usage statistics page backed by the core's built-in SQLite usage store.
 * Every request is guarded by a request id so a slow response from an older range
 * or connection never overwrites newer state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import {
  isUsageStoreDisabled,
  usageStoreApi,
  type UsageAggregate,
  type UsageEvent,
  type UsagePricing,
  type UsageStats,
} from '@/services/api/usageStore';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore } from '@/stores';
import { UsageChart } from './UsageChart';
import {
  USAGE_METRICS,
  USAGE_RANGES,
  formatCompact,
  formatCost,
  formatMs,
  inputTokens,
  rangeWindow,
  successRate,
  type UsageMetric,
  type UsageRange,
} from './format';
import styles from './UsagePage.module.scss';

const EVENTS_PAGE_SIZE = 50;
const ENABLE_RETRY_MS = 1500;

type EventFilter = 'all' | 'failed';

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

export function UsagePage() {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const connected = connectionStatus === 'connected';

  const [range, setRange] = useState<UsageRange>('24h');
  const [metric, setMetric] = useState<UsageMetric>('requests');
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [pricing, setPricing] = useState<UsagePricing | null>(null);
  const [credentialNames, setCredentialNames] = useState<Map<string, string>>(new Map());
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [enabling, setEnabling] = useState(false);
  const [refreshingPrices, setRefreshingPrices] = useState(false);

  const [eventFilter, setEventFilter] = useState<EventFilter>('all');
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [eventsDone, setEventsDone] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);

  const requestRef = useRef(0);
  const eventsRequestRef = useRef(0);

  const loadEvents = useCallback(
    async (before: number, window: { from: number; to: number }, filter: EventFilter) => {
      const requestId = ++eventsRequestRef.current;
      setEventsLoading(true);
      try {
        const page = await usageStoreApi.getEvents({
          from: window.from,
          to: window.to,
          failed: filter === 'failed' ? true : undefined,
          before: before || undefined,
          limit: EVENTS_PAGE_SIZE,
        });
        if (requestId !== eventsRequestRef.current) return;
        setEvents((prev) => (before ? [...prev, ...page.events] : page.events));
        setEventsDone(page.events.length < EVENTS_PAGE_SIZE);
      } catch (err: unknown) {
        if (requestId !== eventsRequestRef.current) return;
        setError(errorMessage(err, t('notification.refresh_failed')));
      } finally {
        if (requestId === eventsRequestRef.current) setEventsLoading(false);
      }
    },
    [t]
  );

  const [eventsWindow, setEventsWindow] = useState(() => rangeWindow('24h'));
  const eventFilterRef = useRef<EventFilter>('all');

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    eventsRequestRef.current += 1;
    if (!connected) {
      setLoading(false);
      return;
    }
    const nextWindow = rangeWindow(range);
    setEventsWindow(nextWindow);
    setLoading(true);
    setError('');
    try {
      const [nextStats, nextPricing] = await Promise.all([
        usageStoreApi.getStats(nextWindow.from, nextWindow.to, nextWindow.tzOffset),
        usageStoreApi.getPricing(),
      ]);
      if (requestId !== requestRef.current) return;
      setDisabled(false);
      setStats(nextStats);
      setPricing(nextPricing);
      void loadEvents(0, nextWindow, eventFilterRef.current);
    } catch (err: unknown) {
      if (requestId !== requestRef.current) return;
      if (isUsageStoreDisabled(err)) {
        setDisabled(true);
        setStats(null);
      } else {
        setError(errorMessage(err, t('notification.refresh_failed')));
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [connected, loadEvents, range, t]);

  useHeaderRefresh(load);

  useEffect(() => {
    void load();
    return () => {
      requestRef.current += 1;
      eventsRequestRef.current += 1;
    };
  }, [load]);

  // Credential labels are best effort: unmatched indexes fall back to the raw auth index.
  useEffect(() => {
    if (!connected) return;
    let active = true;
    authFilesApi
      .list()
      .then((data) => {
        if (!active) return;
        const names = new Map<string, string>();
        (data?.files || []).forEach((file) => {
          if (file.authIndex !== undefined && file.authIndex !== null) {
            names.set(String(file.authIndex), file.email || file.name);
          }
        });
        setCredentialNames(names);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [connected]);

  const handleEnable = useCallback(async () => {
    setEnabling(true);
    setError('');
    try {
      await usageStoreApi.enable();
      // The backend applies the saved config through its watcher; give it a moment.
      await new Promise((resolve) => setTimeout(resolve, ENABLE_RETRY_MS));
      await load();
    } catch (err: unknown) {
      setError(errorMessage(err, t('notification.update_failed')));
    } finally {
      setEnabling(false);
    }
  }, [load, t]);

  const handleRefreshPrices = useCallback(async () => {
    setRefreshingPrices(true);
    try {
      setPricing(await usageStoreApi.refreshPricing());
      await load();
    } catch (err: unknown) {
      setError(errorMessage(err, t('notification.refresh_failed')));
    } finally {
      setRefreshingPrices(false);
    }
  }, [load, t]);

  const rangeOptions = useMemo(
    () => USAGE_RANGES.map((value) => ({ value, label: t(`usage_stats.range_${value}`) })),
    [t]
  );
  const filterOptions = useMemo(
    () => [
      { value: 'all', label: t('usage_stats.events_filter_all') },
      { value: 'failed', label: t('usage_stats.events_filter_failed') },
    ],
    [t]
  );

  const credentialLabel = (authIndex: string) =>
    credentialNames.get(authIndex) || authIndex || t('usage_stats.none');
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

  const totals = stats?.totals;
  const rate = totals ? successRate(totals) : null;

  const renderCostCell = (a: UsageAggregate) =>
    a.unpricedRequests >= a.requests && a.requests > 0 ? (
      <span className={styles.muted}>{t('usage_stats.unpriced')}</span>
    ) : (
      formatCost(a.cost)
    );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.copy}>
          <h1 className={styles.title}>{t('usage_stats.title')}</h1>
          <p className={styles.meta}>
            {totals
              ? t('usage_stats.meta', {
                  requests: formatCompact(totals.requests),
                  cost: formatCost(totals.cost),
                })
              : t('usage_stats.subtitle')}
          </p>
        </div>
        <div className={styles.actions}>
          <Select
            value={range}
            options={rangeOptions}
            onChange={(value) => setRange(value as UsageRange)}
            ariaLabel={t('usage_stats.range_label')}
            size="sm"
            disabled={!connected || disabled}
          />
        </div>
      </header>

      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}

      {disabled ? (
        <EmptyState
          title={t('usage_stats.disabled_title')}
          description={t('usage_stats.disabled_desc')}
          action={
            <Button size="sm" onClick={() => void handleEnable()} loading={enabling}>
              {t('usage_stats.enable')}
            </Button>
          }
        />
      ) : loading && !stats ? (
        <div className={styles.cards} aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} height={92} rounded={14} />
          ))}
        </div>
      ) : stats && totals ? (
        <>
          <section className={styles.cards} aria-label={t('usage_stats.summary_label')}>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>{t('usage_stats.card_requests')}</span>
              <span className={styles.statValue}>{formatCompact(totals.requests)}</span>
              <span className={styles.statSub}>
                {t('usage_stats.card_failed', { count: totals.failed })}
              </span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>{t('usage_stats.card_success_rate')}</span>
              <span className={styles.statValue}>
                {rate === null ? '—' : `${rate.toFixed(1)}%`}
              </span>
              <span className={styles.statSub}>&nbsp;</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>{t('usage_stats.card_tokens')}</span>
              <span className={styles.statValue}>{formatCompact(totals.tokens.total)}</span>
              <span className={styles.statSub}>
                {t('usage_stats.card_tokens_sub', {
                  input: formatCompact(inputTokens(totals)),
                  cached: formatCompact(totals.tokens.cacheRead),
                  output: formatCompact(totals.tokens.output),
                })}
              </span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>{t('usage_stats.card_cost')}</span>
              <span className={styles.statValue}>{formatCost(totals.cost)}</span>
              <span className={styles.statSub}>
                {totals.unpricedRequests > 0
                  ? t('usage_stats.card_unpriced', { count: totals.unpricedRequests })
                  : t('usage_stats.card_cost_sub')}
              </span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>{t('usage_stats.card_latency')}</span>
              <span className={styles.statValue}>{formatMs(totals.avgLatencyMs)}</span>
              <span className={styles.statSub}>
                {t('usage_stats.card_ttft', { value: formatMs(totals.avgTtftMs) })}
              </span>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>{t('usage_stats.trend_title')}</h2>
              <div
                className={styles.segmented}
                role="group"
                aria-label={t('usage_stats.metric_label')}
              >
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
            <UsageChart series={stats.series} bucket={stats.bucket} metric={metric} />
          </section>

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
                    <TableHead alignRight>{t('usage_stats.col_failed')}</TableHead>
                    <TableHead alignRight>{t('usage_stats.col_input')}</TableHead>
                    <TableHead alignRight>{t('usage_stats.col_cached')}</TableHead>
                    <TableHead alignRight>{t('usage_stats.col_output')}</TableHead>
                    <TableHead alignRight>{t('usage_stats.col_cost')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.models.map((m) => (
                    <TableRow key={`${m.provider}:${m.model}`}>
                      <TableCell className={styles.mono}>{m.model}</TableCell>
                      <TableCell>{m.provider}</TableCell>
                      <TableCell alignRight>{formatCompact(m.requests)}</TableCell>
                      <TableCell alignRight>{formatCompact(m.failed)}</TableCell>
                      <TableCell alignRight>{formatCompact(inputTokens(m))}</TableCell>
                      <TableCell alignRight>{formatCompact(m.tokens.cacheRead)}</TableCell>
                      <TableCell alignRight>{formatCompact(m.tokens.output)}</TableCell>
                      <TableCell alignRight>{renderCostCell(m)}</TableCell>
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
                      <TableRow key={k.apiKeyId || 'none'}>
                        <TableCell className={styles.mono}>
                          {k.apiKey || t('usage_stats.none')}
                        </TableCell>
                        <TableCell alignRight>{formatCompact(k.requests)}</TableCell>
                        <TableCell alignRight>{formatCompact(k.tokens.total)}</TableCell>
                        <TableCell alignRight>{renderCostCell(k)}</TableCell>
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
                      <TableHead alignRight>{t('usage_stats.col_failed')}</TableHead>
                      <TableHead alignRight>{t('usage_stats.col_cost')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.credentials.map((c) => (
                      <TableRow key={c.authIndex || 'none'}>
                        <TableCell>
                          <span className={styles.cellMain}>{credentialLabel(c.authIndex)}</span>
                          <span className={styles.cellSub}>{c.provider}</span>
                        </TableCell>
                        <TableCell alignRight>{formatCompact(c.requests)}</TableCell>
                        <TableCell alignRight>{formatCompact(c.failed)}</TableCell>
                        <TableCell alignRight>{renderCostCell(c)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </div>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>{t('usage_stats.events_title')}</h2>
              <div className={styles.filter}>
                <Select
                  value={eventFilter}
                  options={filterOptions}
                  onChange={(value) => {
                    eventFilterRef.current = value as EventFilter;
                    setEventFilter(value as EventFilter);
                    void loadEvents(0, eventsWindow, value as EventFilter);
                  }}
                  ariaLabel={t('usage_stats.events_filter_label')}
                  size="sm"
                />
              </div>
            </div>
            {events.length === 0 && !eventsLoading ? (
              <p className={styles.muted}>{t('usage_stats.events_empty')}</p>
            ) : (
              <Table className={styles.table}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('usage_stats.col_time')}</TableHead>
                    <TableHead>{t('usage_stats.col_model')}</TableHead>
                    <TableHead>{t('usage_stats.col_credential')}</TableHead>
                    <TableHead>{t('usage_stats.col_key')}</TableHead>
                    <TableHead alignRight>{t('usage_stats.col_status')}</TableHead>
                    <TableHead alignRight>{t('usage_stats.col_latency')}</TableHead>
                    <TableHead alignRight>{t('usage_stats.col_tokens')}</TableHead>
                    <TableHead alignRight>{t('usage_stats.col_cost')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className={styles.mono}>
                        {timeFormatter.format(new Date(e.timestamp))}
                      </TableCell>
                      <TableCell>
                        <span className={`${styles.cellMain} ${styles.mono}`}>{e.model}</span>
                        <span className={styles.cellSub}>
                          {[e.provider, e.serviceTier, e.stream ? t('usage_stats.stream') : '']
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </TableCell>
                      <TableCell>{credentialLabel(e.authIndex)}</TableCell>
                      <TableCell className={styles.mono}>
                        {e.apiKey || t('usage_stats.none')}
                      </TableCell>
                      <TableCell alignRight>
                        <span
                          className={e.failed ? styles.statusFailed : styles.statusOk}
                          title={e.error || undefined}
                        >
                          {e.statusCode || (e.failed ? t('usage_stats.failed') : 'OK')}
                        </span>
                      </TableCell>
                      <TableCell alignRight>{formatMs(e.latencyMs)}</TableCell>
                      <TableCell alignRight>{formatCompact(e.tokens.total)}</TableCell>
                      <TableCell alignRight>
                        {e.priced ? (
                          formatCost(e.cost)
                        ) : (
                          <span className={styles.muted}>{t('usage_stats.unpriced')}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {!eventsDone && events.length > 0 && (
              <div className={styles.loadMore}>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={eventsLoading}
                  onClick={() =>
                    void loadEvents(events[events.length - 1].id, eventsWindow, eventFilter)
                  }
                >
                  {t('usage_stats.load_more')}
                </Button>
              </div>
            )}
          </section>

          {pricing && (
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2 className={styles.panelTitle}>{t('usage_stats.pricing_title')}</h2>
                  <p className={styles.muted}>
                    {!pricing.modelsDev.enabled
                      ? t('usage_stats.pricing_models_dev_off')
                      : pricing.modelsDev.updatedAt
                        ? t('usage_stats.pricing_models_dev_status', {
                            count: pricing.modelsDev.count,
                            time: new Date(pricing.modelsDev.updatedAt).toLocaleString(
                              i18n.language
                            ),
                          })
                        : t('usage_stats.pricing_models_dev_pending')}
                  </p>
                  {pricing.modelsDev.lastError && (
                    <p className={styles.errorText}>{pricing.modelsDev.lastError}</p>
                  )}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={refreshingPrices}
                  disabled={!pricing.modelsDev.enabled}
                  onClick={() => void handleRefreshPrices()}
                >
                  {t('usage_stats.pricing_refresh')}
                </Button>
              </div>
              {pricing.models.length > 0 && (
                <Table className={styles.table}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('usage_stats.col_model')}</TableHead>
                      <TableHead>{t('usage_stats.col_source')}</TableHead>
                      <TableHead alignRight>{t('usage_stats.col_price_input')}</TableHead>
                      <TableHead alignRight>{t('usage_stats.col_price_output')}</TableHead>
                      <TableHead alignRight>{t('usage_stats.col_price_cache_read')}</TableHead>
                      <TableHead alignRight>{t('usage_stats.col_price_cache_write')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pricing.models.map((m) => (
                      <TableRow key={m.model}>
                        <TableCell className={styles.mono}>{m.model}</TableCell>
                        <TableCell>
                          {m.source === 'override'
                            ? t('usage_stats.source_override')
                            : m.source
                              ? 'models.dev'
                              : t('usage_stats.unpriced')}
                        </TableCell>
                        <TableCell alignRight>{m.price ? `$${m.price.input}` : '—'}</TableCell>
                        <TableCell alignRight>{m.price ? `$${m.price.output}` : '—'}</TableCell>
                        <TableCell alignRight>{m.price ? `$${m.price.cacheRead}` : '—'}</TableCell>
                        <TableCell alignRight>{m.price ? `$${m.price.cacheWrite}` : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className={styles.muted}>{t('usage_stats.pricing_hint')}</p>
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}
