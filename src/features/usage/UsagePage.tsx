/**
 * Usage statistics backed by the core's built-in SQLite usage store, split into
 * overview / analysis / request events / pricing tabs (selected with ?tab=).
 * Requests carry a request id so a slow response for an older range never wins.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { authFilesApi } from '@/services/api';
import {
  isUsageStoreDisabled,
  usageStoreApi,
  type UsagePricing,
  type UsageStats,
} from '@/services/api/usageStore';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore } from '@/stores';
import {
  USAGE_RANGES,
  USAGE_TABS,
  formatCompact,
  formatCost,
  isUsageTab,
  previousWindow,
  rangeWindow,
  type UsageRange,
  type UsageTab,
} from './format';
import { OverviewTab } from './tabs/OverviewTab';
import { AnalysisTab } from './tabs/AnalysisTab';
import { EventsTab } from './tabs/EventsTab';
import type { EventsFilter } from './logic';
import { PricingTab } from './tabs/PricingTab';
import styles from './UsagePage.module.scss';

const ENABLE_RETRY_MS = 1500;
const FILTER_PARAMS = ['model', 'provider', 'api_key_id', 'auth_index', 'result'] as const;

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

export type UsageWindow = ReturnType<typeof rangeWindow>;

export function UsagePage() {
  const { t } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus) === 'connected';
  // PageTransition keeps a route's first location while the pathname is unchanged, so the
  // search params only seed state on mount; afterwards state is the source of truth.
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<UsageTab>(() => {
    const value = searchParams.get('tab');
    return isUsageTab(value) ? value : 'overview';
  });
  const [eventsFilter, setEventsFilter] = useState<EventsFilter>(() => {
    const filter: EventsFilter = {};
    FILTER_PARAMS.forEach((key) => {
      const value = searchParams.get(key);
      if (value) filter[key] = value;
    });
    return filter;
  });

  const [range, setRange] = useState<UsageRange>('24h');
  const [usageWindow, setUsageWindow] = useState<UsageWindow>(() => rangeWindow('24h'));
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [prevStats, setPrevStats] = useState<UsageStats | null>(null);
  const [pricing, setPricing] = useState<UsagePricing | null>(null);
  const [credentialNames, setCredentialNames] = useState<Map<string, string>>(new Map());
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [enabling, setEnabling] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!connected) {
      setLoading(false);
      return;
    }
    const next = rangeWindow(range);
    const prev = previousWindow(next);
    setLoading(true);
    setError('');
    try {
      const [nextStats, nextPrev, nextPricing] = await Promise.all([
        usageStoreApi.getStats(next.from, next.to, next.tzOffset),
        usageStoreApi.getStats(prev.from, prev.to, next.tzOffset),
        usageStoreApi.getPricing(),
      ]);
      if (requestId !== requestRef.current) return;
      setDisabled(false);
      setUsageWindow(next);
      setStats(nextStats);
      setPrevStats(nextPrev);
      setPricing(nextPricing);
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
  }, [connected, range, t]);

  useHeaderRefresh(load);

  useEffect(() => {
    void load();
    return () => {
      requestRef.current += 1;
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

  const credentialLabel = useCallback(
    (authIndex: string) => credentialNames.get(authIndex) || authIndex || t('usage_stats.none'),
    [credentialNames, t]
  );

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

  const selectTab = useCallback(
    (next: UsageTab, filter?: EventsFilter) => {
      const nextFilter = filter ?? eventsFilter;
      setTab(next);
      setEventsFilter(nextFilter);
      const params = new URLSearchParams();
      params.set('tab', next);
      if (next === 'events') {
        FILTER_PARAMS.forEach((key) => {
          const value = nextFilter[key];
          if (value) params.set(key, value);
        });
      }
      setSearchParams(params, { replace: true });
    },
    [eventsFilter, setSearchParams]
  );

  const rangeOptions = useMemo(
    () => USAGE_RANGES.map((value) => ({ value, label: t(`usage_stats.range_${value}`) })),
    [t]
  );

  const totals = stats?.totals;

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

      {!disabled && (
        <div className={styles.tabs} role="tablist" aria-label={t('usage_stats.tabs_label')}>
          {USAGE_TABS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`usage-tab-${value}`}
              aria-selected={tab === value}
              aria-controls={`usage-panel-${value}`}
              className={tab === value ? styles.tabActive : styles.tab}
              onClick={() => selectTab(value)}
            >
              {t(`usage_stats.tab_${value}`)}
            </button>
          ))}
        </div>
      )}

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
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} height={96} rounded={14} />
          ))}
        </div>
      ) : stats ? (
        <div
          role="tabpanel"
          id={`usage-panel-${tab}`}
          aria-labelledby={`usage-tab-${tab}`}
          className={styles.panelStack}
        >
          {tab === 'overview' && (
            <OverviewTab
              stats={stats}
              prevStats={prevStats}
              credentialLabel={credentialLabel}
              onOpenEvents={(filter) => selectTab('events', filter)}
            />
          )}
          {tab === 'analysis' && <AnalysisTab usageWindow={usageWindow} stats={stats} />}
          {tab === 'events' && (
            <EventsTab
              usageWindow={usageWindow}
              stats={stats}
              filter={eventsFilter}
              onFilterChange={(filter) => selectTab('events', filter)}
              credentialLabel={credentialLabel}
            />
          )}
          {tab === 'pricing' && pricing && (
            <PricingTab pricing={pricing} onPricingChange={setPricing} onReload={load} />
          )}
        </div>
      ) : null}
    </div>
  );
}
