import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, Line } from 'react-chartjs-2';
import {
  usageStoreApi,
  type UsageDimensionFilter,
  type UsageEvent,
  type UsageRealtime,
} from '@/services/api/usageStore';
import { Button } from '@/components/ui/Button';
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
import { METRIC_ACCENTS, baseCartesianOptions, useChartTheme } from '../charts';
import { EventDetailModal } from '../components/EventDetailModal';
import {
  EventLatencyCell,
  EventModelCell,
  EventRouteCell,
  EventStatusCell,
  EventTokensCell,
} from '../components/EventCells';
import { PanelHeading } from '../components/PanelBits';
import { StatCard } from '../components/StatCard';
import { formatCompact, formatCost, formatMs } from '../format';
import type { UsageLabels } from '../hooks/useUsageLabels';
import { REALTIME_FEED_LIMIT, mergeRealtimeFeed } from '../logic';
import styles from '../UsagePage.module.scss';

const POLL_MS = 5000;
const HIGHLIGHT_MS = 4000;
const WINDOWS = [15, 60, 180] as const;

interface RealtimeTabProps {
  dimensionFilter: UsageDimensionFilter;
  labels: UsageLabels;
}

/**
 * Last-N-minutes view refreshed every few seconds. The feed polls only rows newer than the
 * newest one shown (`after`), and polling stops while paused or while the browser tab is hidden.
 */
export function RealtimeTab({ dimensionFilter, labels }: RealtimeTabProps) {
  const { t, i18n } = useTranslation();
  const theme = useChartTheme();
  const [minutes, setMinutes] = useState<number>(60);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(
    () => typeof document !== 'undefined' && document.visibilityState === 'hidden'
  );
  const [data, setData] = useState<UsageRealtime | null>(null);
  const [feed, setFeed] = useState<UsageEvent[]>([]);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [selected, setSelected] = useState<UsageEvent | null>(null);
  // Bumped on every filter/window change; responses from an older generation are dropped.
  const generationRef = useRef(0);
  const cursorRef = useRef(0);
  const inFlightRef = useRef(false);
  // Mirror of `feed` so a poll can merge and know which ids are new in one step.
  const feedRef = useRef<UsageEvent[]>([]);

  const filterKey = JSON.stringify(dimensionFilter);
  const eventFilter = useMemo(
    () => ({
      model: dimensionFilter.model,
      provider: dimensionFilter.provider,
      apiKeyId: dimensionFilter.apiKeyId,
      authIndex: dimensionFilter.authIndex,
    }),
    // filterKey captures the array contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterKey]
  );

  const tick = useCallback(
    async (initial: boolean) => {
      if (inFlightRef.current && !initial) return;
      const generation = generationRef.current;
      inFlightRef.current = true;
      try {
        const [next, page] = await Promise.all([
          usageStoreApi.getRealtime(minutes, eventFilter),
          initial
            ? usageStoreApi.getEvents({ ...eventFilter, limit: 30 })
            : usageStoreApi.getEvents({ ...eventFilter, after: cursorRef.current, limit: 200 }),
        ]);
        if (generation !== generationRef.current) return;
        setData(next);
        setError('');
        setUpdatedAt(Date.now());
        if (initial) {
          feedRef.current = page.events;
          setFeed(page.events);
          setFresh(new Set());
          cursorRef.current = page.events[0]?.id ?? next.lastId;
          return;
        }
        if (page.events.length === 0) return;
        cursorRef.current = Math.max(cursorRef.current, page.lastId);
        const { feed: merged, added } = mergeRealtimeFeed(feedRef.current, page.events);
        feedRef.current = merged;
        setFeed(merged);
        if (added.length > 0) {
          setFresh((prev) => new Set([...prev, ...added]));
          window.setTimeout(() => {
            if (generation !== generationRef.current) return;
            setFresh((prev) => {
              const next = new Set(prev);
              added.forEach((id) => next.delete(id));
              return next;
            });
          }, HIGHLIGHT_MS);
        }
      } catch (err: unknown) {
        if (generation !== generationRef.current) return;
        setError(err instanceof Error ? err.message : t('notification.refresh_failed'));
      } finally {
        if (generation === generationRef.current) inFlightRef.current = false;
      }
    },
    [eventFilter, minutes, t]
  );

  // Reload from scratch whenever the filter or window changes.
  useEffect(() => {
    generationRef.current += 1;
    inFlightRef.current = false;
    cursorRef.current = 0;
    feedRef.current = [];
    setData(null);
    setFeed([]);
    void tick(true);
    return () => {
      generationRef.current += 1;
    };
  }, [tick]);

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (paused || hidden) return;
    const timer = window.setInterval(() => void tick(false), POLL_MS);
    return () => window.clearInterval(timer);
  }, [hidden, paused, tick]);

  const labelsForChart = useMemo(
    () =>
      (data?.series ?? []).map((p) =>
        new Date(p.time * 1000).toLocaleTimeString(i18n.language, {
          hour: '2-digit',
          minute: '2-digit',
        })
      ),
    [data?.series, i18n.language]
  );

  const requestsChart = useMemo(
    () => ({
      data: {
        labels: labelsForChart,
        datasets: [
          {
            label: t('usage_stats.series_success'),
            data: (data?.series ?? []).map((p) => p.requests - p.failed),
            backgroundColor: theme.success,
            borderRadius: 2,
          },
          {
            label: t('usage_stats.series_failed'),
            data: (data?.series ?? []).map((p) => p.failed),
            backgroundColor: theme.failure,
            borderRadius: 2,
          },
        ],
      },
      options: baseCartesianOptions(theme, true),
    }),
    [data?.series, labelsForChart, t, theme]
  );

  const tokensChart = useMemo(
    () => ({
      data: {
        labels: labelsForChart,
        datasets: [
          {
            label: t('usage_stats.metric_tokens'),
            data: (data?.series ?? []).map((p) => p.tokens),
            borderColor: METRIC_ACCENTS.tokens,
            backgroundColor: `${METRIC_ACCENTS.tokens}33`,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
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
    }),
    [data?.series, labelsForChart, t, theme]
  );

  const windowOptions = WINDOWS.map((value) => ({
    value: String(value),
    label: t('usage_stats.realtime_window', { count: value }),
  }));
  const timeFormatter = new Intl.DateTimeFormat(i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const live = !paused && !hidden;

  return (
    <>
      <div className={styles.realtimeBar}>
        <span className={live ? styles.liveDot : styles.liveDotPaused} aria-hidden="true" />
        <span className={styles.realtimeStatus} role="status" aria-live="polite">
          {live
            ? t('usage_stats.realtime_live', { seconds: POLL_MS / 1000 })
            : paused
              ? t('usage_stats.realtime_paused')
              : t('usage_stats.realtime_hidden')}
          {updatedAt && (
            <span className={styles.muted}>
              {' · '}
              {t('usage_stats.realtime_updated', { time: timeFormatter.format(updatedAt) })}
            </span>
          )}
        </span>
        <div className={styles.toolbarActions}>
          <Select
            value={String(minutes)}
            options={windowOptions}
            onChange={(value) => setMinutes(Number(value))}
            ariaLabel={t('usage_stats.realtime_window_label')}
            size="sm"
          />
          <Button variant="secondary" size="sm" onClick={() => setPaused((p) => !p)}>
            {paused ? t('usage_stats.realtime_resume') : t('usage_stats.realtime_pause')}
          </Button>
        </div>
      </div>
      <p className={styles.muted}>{t('usage_stats.realtime_range_hint')}</p>

      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}

      {!data ? (
        <Skeleton height={320} rounded={14} />
      ) : (
        <>
          <section className={styles.cards} aria-label={t('usage_stats.realtime_title')}>
            <StatCard
              accent="requests"
              label={t('usage_stats.realtime_rpm')}
              value={formatCompact(data.current.rpm1m)}
              sub={t('usage_stats.realtime_avg_5m', { value: formatCompact(data.current.rpm5m) })}
              spark={data.series.slice(-30).map((p) => p.requests)}
            />
            <StatCard
              accent="tokens"
              label={t('usage_stats.realtime_tpm')}
              value={formatCompact(data.current.tpm1m)}
              sub={t('usage_stats.realtime_avg_5m', { value: formatCompact(data.current.tpm5m) })}
              spark={data.series.slice(-30).map((p) => p.tokens)}
            />
            <StatCard
              accent="success"
              label={t('usage_stats.realtime_failed_5m')}
              value={formatCompact(data.current.failed5m)}
              spark={data.series.slice(-30).map((p) => p.failed)}
            />
            <StatCard
              accent="latency"
              label={t('usage_stats.realtime_latency_5m')}
              value={formatMs(data.current.avgLatency5m)}
              spark={data.series.slice(-30).map((p) => p.avgLatencyMs)}
            />
          </section>

          <div className={styles.split}>
            <section className={styles.panel}>
              <PanelHeading
                title={t('usage_stats.realtime_requests_title')}
                desc={t('usage_stats.realtime_per_minute', { count: minutes })}
              />
              <div
                className={styles.chartBoxSmall}
                role="img"
                aria-label={t('usage_stats.realtime_requests_title')}
              >
                <Bar data={requestsChart.data} options={requestsChart.options} />
              </div>
            </section>
            <section className={styles.panel}>
              <PanelHeading
                title={t('usage_stats.realtime_tokens_title')}
                desc={t('usage_stats.realtime_per_minute', { count: minutes })}
              />
              <div
                className={styles.chartBoxSmall}
                role="img"
                aria-label={t('usage_stats.realtime_tokens_title')}
              >
                <Line data={tokensChart.data} options={tokensChart.options} />
              </div>
            </section>
          </div>
        </>
      )}

      <section className={styles.panel}>
        <PanelHeading
          title={t('usage_stats.realtime_feed_title')}
          desc={t('usage_stats.realtime_feed_desc', { count: REALTIME_FEED_LIMIT })}
        />
        {feed.length === 0 ? (
          <p className={styles.muted}>{t('usage_stats.realtime_feed_empty')}</p>
        ) : (
          <Table className={styles.table}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('usage_stats.column_time')}</TableHead>
                <TableHead>{t('usage_stats.column_status')}</TableHead>
                <TableHead>{t('usage_stats.column_model')}</TableHead>
                <TableHead>{t('usage_stats.column_route')}</TableHead>
                <TableHead alignRight>{t('usage_stats.column_tokens')}</TableHead>
                <TableHead alignRight>{t('usage_stats.column_latency')}</TableHead>
                <TableHead alignRight>{t('usage_stats.column_cost')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {feed.map((e) => {
                const rowClass = [
                  styles.clickableRow,
                  e.failed ? styles.failedRow : '',
                  fresh.has(e.id) ? styles.freshRow : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <TableRow
                    key={e.id}
                    className={rowClass}
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
                    <TableCell className={styles.mono}>
                      {timeFormatter.format(new Date(e.timestamp))}
                    </TableCell>
                    <TableCell>
                      <EventStatusCell event={e} />
                    </TableCell>
                    <TableCell>
                      <EventModelCell event={e} />
                    </TableCell>
                    <TableCell>
                      <EventRouteCell event={e} labels={labels} />
                    </TableCell>
                    <TableCell alignRight>
                      <EventTokensCell event={e} />
                    </TableCell>
                    <TableCell alignRight>
                      <EventLatencyCell event={e} />
                    </TableCell>
                    <TableCell alignRight>
                      {e.priced ? (
                        <span className={styles.cellStrong}>{formatCost(e.cost)}</span>
                      ) : (
                        <span className={styles.muted}>{t('usage_stats.unpriced')}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>
      <EventDetailModal event={selected} labels={labels} onClose={() => setSelected(null)} />
    </>
  );
}
