/**
 * Usage statistics backed by the core's built-in SQLite usage store, split into
 * overview / analysis / quota value / request events / pricing tabs (selected with ?tab=).
 * Requests carry a request id so a slow response for an older range never wins.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import {
  isUsageStoreDisabled,
  usageStoreApi,
  type UsageDimensionFilter,
  type UsageOptions,
  type UsagePricing,
  type UsageStats,
} from '@/services/api/usageStore';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { IconX } from '@/components/ui/icons';
import { getTypeLabel } from '@/features/authFiles/constants';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useInterval } from '@/hooks/useInterval';
import { useAuthStore, useConfigStore } from '@/stores';
import {
  USAGE_RANGES,
  USAGE_TABS,
  formatCompact,
  formatCost,
  formatDatetimeLocal,
  isUsageTab,
  parseDatetimeLocal,
  previousWindow,
  rangeWindow,
  validateCustomRange,
  type UsageRange,
  type UsageTab,
} from './format';
import { OverviewTab } from './tabs/OverviewTab';
import { AnalysisTab } from './tabs/AnalysisTab';
import { RealtimeTab } from './tabs/RealtimeTab';
import { EventsTab } from './tabs/EventsTab';
import { QuotaValueTab } from './tabs/QuotaValueTab';
import {
  AUTO_REFRESH_SECONDS,
  emptyGlobalFilter,
  hasActiveGlobalFilters,
  parseGlobalFilterFromSearchParams,
  providerDisplay,
  readUsagePrefs,
  saveUsagePrefs,
  serializeGlobalFilterToSearchParams,
  type EventsFilter,
  type MultiSelectOption,
  type UsageGlobalFilter,
} from './logic';
import { PricingTab } from './tabs/PricingTab';
import { useUsageLabels } from './hooks/useUsageLabels';
import { RevealGroup } from './components/Motion';
import { MultiSelectFilter } from './components/MultiSelectFilter';
import { KeyLabel, ProviderBadge } from './components/Labels';
import { StoreSettingsCard } from './components/StoreSettingsCard';
import styles from './UsagePage.module.scss';

const ENABLE_RETRY_MS = 1500;
const NO_PRICES: UsagePricing['models'] = [];

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

export type UsageWindow = ReturnType<typeof rangeWindow>;

export function UsagePage() {
  const { t } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus) === 'connected';

  // Seed filter and tab state once from searchParams on mount.
  const [searchParams, setSearchParams] = useSearchParams();
  // A plain visit (no search params) restores the last tab and range; links keep theirs.
  const [prefs] = useState(() => (searchParams.toString() === '' ? readUsagePrefs() : {}));
  const [tab, setTab] = useState<UsageTab>(() => {
    const value = searchParams.get('tab');
    return isUsageTab(value) ? value : (prefs.tab ?? 'overview');
  });
  const [globalFilter, setGlobalFilter] = useState<UsageGlobalFilter>(() => {
    const parsed = parseGlobalFilterFromSearchParams(searchParams);
    return prefs.range ? { ...parsed, range: prefs.range } : parsed;
  });
  const [resultFilter, setResultFilter] = useState<string | undefined>(
    () => searchParams.get('result') || undefined
  );

  const [usageWindow, setUsageWindow] = useState<UsageWindow>(() =>
    rangeWindow(globalFilter.range, Date.now(), globalFilter.customFrom, globalFilter.customTo)
  );
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [prevStats, setPrevStats] = useState<UsageStats | null>(null);
  const [options, setOptions] = useState<UsageOptions | null>(null);
  const [pricing, setPricing] = useState<UsagePricing | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [enabling, setEnabling] = useState(false);

  // Custom datetime-local inputs state and validation.
  const [customFromInput, setCustomFromInput] = useState<string>(() =>
    globalFilter.customFrom ? formatDatetimeLocal(globalFilter.customFrom) : ''
  );
  const [customToInput, setCustomToInput] = useState<string>(() =>
    globalFilter.customTo ? formatDatetimeLocal(globalFilter.customTo) : ''
  );
  const [customRangeError, setCustomRangeError] = useState<string | null>(null);

  const requestRef = useRef(0);
  const labels = useUsageLabels(connected);
  // A link's own tab and range are not the user's choice: save only once they change them.
  // Compared by value rather than a run-once flag so StrictMode's double effect cannot save.
  const linkView = useRef(
    searchParams.toString() !== '' ? { tab, range: globalFilter.range } : null
  );

  useEffect(() => {
    const link = linkView.current;
    if (link && link.tab === tab && link.range === globalFilter.range) return;
    linkView.current = null;
    saveUsagePrefs(globalFilter.range === 'custom' ? { tab } : { tab, range: globalFilter.range });
  }, [globalFilter.range, tab]);

  // Keep search params in sync with tab, globalFilter and resultFilter.
  useEffect(() => {
    const params = serializeGlobalFilterToSearchParams(globalFilter, tab, resultFilter);
    setSearchParams(params, { replace: true });
  }, [globalFilter, tab, resultFilter, setSearchParams]);

  // Prices change only through the pricing tab or the backend's daily models.dev refresh.
  // Explicit loads (header refresh, pricing tab reload, enabling the store) refetch them;
  // filter changes fetch them only until they have loaded once, and auto-refresh never does.
  const pricingLoadedRef = useRef(false);
  const load = useCallback(
    async (refreshPricing = true) => {
      const requestId = ++requestRef.current;
      if (!connected) {
        pricingLoadedRef.current = false;
        setLoading(false);
        return;
      }
      const next = rangeWindow(
        globalFilter.range,
        Date.now(),
        globalFilter.customFrom,
        globalFilter.customTo
      );
      const prev = previousWindow(next);
      const dimFilter: UsageDimensionFilter = {
        model: globalFilter.models.length ? globalFilter.models : undefined,
        provider: globalFilter.providers.length ? globalFilter.providers : undefined,
        apiKeyId: globalFilter.apiKeyIds.length ? globalFilter.apiKeyIds : undefined,
        authIndex: globalFilter.authIndexes.length ? globalFilter.authIndexes : undefined,
      };
      setLoading(true);
      setError('');
      try {
        const [nextStats, nextPrev, nextPricing, nextOptions] = await Promise.all([
          usageStoreApi.getStats(next.from, next.to, next.tzOffset, dimFilter),
          usageStoreApi.getStats(prev.from, prev.to, next.tzOffset, dimFilter),
          refreshPricing ? usageStoreApi.getPricing() : Promise.resolve(null),
          usageStoreApi.getOptions(next.from, next.to),
        ]);
        if (requestId !== requestRef.current) return;
        setDisabled(false);
        setUsageWindow(next);
        setStats(nextStats);
        setPrevStats(nextPrev);
        if (nextPricing) {
          setPricing(nextPricing);
          pricingLoadedRef.current = true;
        }
        setOptions(nextOptions);
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
    },
    [connected, globalFilter, t]
  );

  useHeaderRefresh(load);

  // Only the overview, analysis and quota value follow the auto-refresh; the realtime tab polls on its own
  // and reloading the events or pricing tabs would drop loaded pages and edits.
  const [autoRefresh, setAutoRefresh] = useState(() => readUsagePrefs().autoRefresh ?? 0);
  const autoRefreshTab = tab === 'overview' || tab === 'analysis' || tab === 'quota_value';
  const autoRefreshActive = autoRefresh > 0 && autoRefreshTab && connected && !disabled;
  useInterval(
    () => {
      if (!document.hidden) void load(false);
    },
    autoRefreshActive ? autoRefresh * 1000 : null
  );
  const autoRefreshOptions = useMemo(
    () =>
      AUTO_REFRESH_SECONDS.map((value) => ({
        value: String(value),
        label: t(`usage_stats.auto_refresh_${value}`),
      })),
    [t]
  );

  useEffect(() => {
    void load(!pricingLoadedRef.current);
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  const handleEnable = useCallback(async () => {
    setEnabling(true);
    setError('');
    try {
      await usageStoreApi.enable();
      useConfigStore.getState().clearCache();
      // The backend applies the saved config through its watcher; give it a moment.
      await new Promise((resolve) => setTimeout(resolve, ENABLE_RETRY_MS));
      await load();
    } catch (err: unknown) {
      setError(errorMessage(err, t('notification.update_failed')));
    } finally {
      setEnabling(false);
    }
  }, [load, t]);

  const selectTab = useCallback((next: UsageTab) => {
    setTab(next);
  }, []);

  const handleAddFilter = useCallback(
    (dimension: 'model' | 'provider' | 'api_key_id' | 'auth_index', value: string) => {
      if (!value) return;
      setGlobalFilter((prev) => {
        const field =
          dimension === 'model'
            ? 'models'
            : dimension === 'provider'
              ? 'providers'
              : dimension === 'api_key_id'
                ? 'apiKeyIds'
                : 'authIndexes';
        if (prev[field].includes(value)) return prev;
        return { ...prev, [field]: [...prev[field], value] };
      });
    },
    []
  );

  const handleRemoveFilter = useCallback(
    (dimension: 'model' | 'provider' | 'api_key_id' | 'auth_index', value: string) => {
      setGlobalFilter((prev) => {
        const field =
          dimension === 'model'
            ? 'models'
            : dimension === 'provider'
              ? 'providers'
              : dimension === 'api_key_id'
                ? 'apiKeyIds'
                : 'authIndexes';
        return { ...prev, [field]: prev[field].filter((item) => item !== value) };
      });
    },
    []
  );

  const handleClearAllFilters = useCallback(() => {
    setGlobalFilter(emptyGlobalFilter());
    setCustomRangeError(null);
  }, []);

  const handleOpenEventsFromOverview = useCallback(
    (filter: EventsFilter) => {
      setGlobalFilter((prev) => ({
        ...prev,
        models: filter.model ? [filter.model] : prev.models,
        providers: filter.provider ? [filter.provider] : prev.providers,
        apiKeyIds: filter.api_key_id ? [filter.api_key_id] : prev.apiKeyIds,
        authIndexes: filter.auth_index ? [filter.auth_index] : prev.authIndexes,
      }));
      selectTab('events');
    },
    [selectTab]
  );

  const handleDrillDown = useCallback(
    (from: number, to: number) => {
      const end = Math.min(to, Math.floor(Date.now() / 1000));
      setGlobalFilter((prev) => ({ ...prev, range: 'custom', customFrom: from, customTo: end }));
      setCustomFromInput(formatDatetimeLocal(from));
      setCustomToInput(formatDatetimeLocal(end));
      setCustomRangeError(null);
      selectTab('events');
    },
    [selectTab]
  );

  const handleCustomDateChange = useCallback(
    (newFrom: string, newTo: string) => {
      setCustomFromInput(newFrom);
      setCustomToInput(newTo);
      const fromSec = parseDatetimeLocal(newFrom);
      const toSec = parseDatetimeLocal(newTo);
      const val = validateCustomRange(fromSec, toSec);
      if (!val.valid) {
        setCustomRangeError(
          val.error === 'order'
            ? t('usage_stats.custom_invalid_order')
            : val.error === 'future'
              ? t('usage_stats.custom_invalid_future')
              : ''
        );
        return;
      }
      setCustomRangeError(null);
      setGlobalFilter((prev) => ({
        ...prev,
        customFrom: fromSec!,
        customTo: toSec!,
      }));
    },
    [t]
  );

  const rangeOptions = useMemo(
    () => USAGE_RANGES.map((value) => ({ value, label: t(`usage_stats.range_${value}`) })),
    [t]
  );

  // Multi-select option lists mapped from options.
  const modelOptions: MultiSelectOption[] = useMemo(() => {
    return (options?.models ?? []).map((m) => ({
      value: m.model,
      label: m.model,
      renderLabel: (
        <span className={styles.multiSelectOptionModel}>
          <span className={styles.mono}>{m.model}</span>
          <ProviderBadge provider={m.provider} />
        </span>
      ),
      requests: m.requests,
    }));
  }, [options?.models]);

  const providerOptions: MultiSelectOption[] = useMemo(() => {
    return (options?.providers ?? []).map((p) => {
      const display = providerDisplay(p.provider);
      const text = display.compat
        ? `${display.name} (${t('usage_stats.compat_tag')})`
        : getTypeLabel(t, display.type);
      return {
        value: p.provider,
        label: text,
        renderLabel: <ProviderBadge provider={p.provider} />,
        requests: p.requests,
      };
    });
  }, [options?.providers, t]);

  const apiKeyOptions: MultiSelectOption[] = useMemo(() => {
    return (options?.apiKeys ?? []).map((k) => {
      const name = labels.keyName(k.apiKeyId);
      const labelText = name
        ? `${name} (${k.apiKey || t('usage_stats.none')})`
        : k.apiKey || t('usage_stats.none');
      return {
        value: k.apiKeyId,
        label: labelText,
        renderLabel: <KeyLabel name={name} masked={k.apiKey} />,
        requests: k.requests,
      };
    });
  }, [labels, options?.apiKeys, t]);

  const credentialOptions: MultiSelectOption[] = useMemo(() => {
    return (options?.credentials ?? []).map((c) => {
      const name = labels.credential(c.authIndex, c.source);
      return {
        value: c.authIndex,
        label: `${name} (${c.provider})`,
        renderLabel: (
          <span className={styles.multiSelectOptionModel}>
            <span>{name}</span>
            <ProviderBadge provider={c.provider} />
          </span>
        ),
        requests: c.requests,
      };
    });
  }, [labels, options?.credentials]);

  // Active filter chips list.
  const activeChips = useMemo(() => {
    const chips: {
      id: string;
      dim: 'model' | 'provider' | 'api_key_id' | 'auth_index';
      value: string;
      dimLabel: string;
      label: ReactNode;
    }[] = [];

    for (const m of globalFilter.models) {
      chips.push({
        id: `m:${m}`,
        dim: 'model',
        value: m,
        dimLabel: t('usage_stats.filter_model'),
        label: <span className={styles.mono}>{m}</span>,
      });
    }
    for (const p of globalFilter.providers) {
      chips.push({
        id: `p:${p}`,
        dim: 'provider',
        value: p,
        dimLabel: t('usage_stats.filter_provider'),
        label: <ProviderBadge provider={p} />,
      });
    }
    for (const k of globalFilter.apiKeyIds) {
      const opt = options?.apiKeys.find((item) => item.apiKeyId === k);
      const masked = opt?.apiKey ?? '';
      chips.push({
        id: `k:${k}`,
        dim: 'api_key_id',
        value: k,
        dimLabel: t('usage_stats.filter_api_key_id'),
        label: <KeyLabel name={labels.keyName(k)} masked={masked} />,
      });
    }
    for (const a of globalFilter.authIndexes) {
      const opt = options?.credentials.find((item) => item.authIndex === a);
      chips.push({
        id: `a:${a}`,
        dim: 'auth_index',
        value: a,
        dimLabel: t('usage_stats.filter_auth_index'),
        label: labels.credential(a, opt?.source),
      });
    }
    return chips;
  }, [globalFilter, labels, options, t]);

  const dimensionFilter: UsageDimensionFilter = useMemo(
    () => ({
      model: globalFilter.models.length ? globalFilter.models : undefined,
      provider: globalFilter.providers.length ? globalFilter.providers : undefined,
      apiKeyId: globalFilter.apiKeyIds.length ? globalFilter.apiKeyIds : undefined,
      authIndex: globalFilter.authIndexes.length ? globalFilter.authIndexes : undefined,
    }),
    [globalFilter]
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
            {stats && (
              <span
                className={stats.exact ? styles.precisionExact : styles.precisionHourly}
                tabIndex={0}
                aria-label={`${t(stats.exact ? 'usage_stats.precision_exact' : 'usage_stats.precision_hourly')}: ${t(stats.exact ? 'usage_stats.precision_exact_hint' : 'usage_stats.precision_hourly_hint')}`}
                title={t(
                  stats.exact
                    ? 'usage_stats.precision_exact_hint'
                    : 'usage_stats.precision_hourly_hint'
                )}
              >
                {t(stats.exact ? 'usage_stats.precision_exact' : 'usage_stats.precision_hourly')}
              </span>
            )}
          </p>
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

      {!disabled && (
        <div className={styles.filterBar}>
          <div className={styles.filterControls}>
            <Select
              value={globalFilter.range}
              options={rangeOptions}
              onChange={(value) => {
                const nextRange = value as UsageRange;
                if (
                  nextRange === 'custom' &&
                  (!globalFilter.customFrom || !globalFilter.customTo)
                ) {
                  const nowSec = Math.floor(Date.now() / 1000);
                  const fromSec = nowSec - 24 * 3600;
                  setGlobalFilter((prev) => ({
                    ...prev,
                    range: nextRange,
                    customFrom: fromSec,
                    customTo: nowSec,
                  }));
                  setCustomFromInput(formatDatetimeLocal(fromSec));
                  setCustomToInput(formatDatetimeLocal(nowSec));
                  setCustomRangeError(null);
                } else {
                  setGlobalFilter((prev) => ({ ...prev, range: nextRange }));
                  setCustomRangeError(null);
                }
              }}
              ariaLabel={t('usage_stats.range_label')}
              size="sm"
              className={styles.rangeSelect}
              disabled={!connected || disabled || tab === 'realtime'}
            />

            {autoRefreshTab && (
              <Select
                value={String(autoRefresh)}
                options={autoRefreshOptions}
                onChange={(value) => {
                  const next = Number(value);
                  setAutoRefresh(next);
                  saveUsagePrefs({ autoRefresh: next });
                }}
                ariaLabel={t('usage_stats.auto_refresh_label')}
                size="sm"
                className={styles.rangeSelect}
                disabled={!connected || disabled}
              />
            )}

            {globalFilter.range === 'custom' && (
              <div className={styles.customRangeWrap}>
                <div className={styles.customRangeInputs}>
                  <input
                    type="datetime-local"
                    className={styles.datetimeInput}
                    value={customFromInput}
                    onChange={(e) => handleCustomDateChange(e.target.value, customToInput)}
                    aria-label={t('usage_stats.custom_from')}
                  />
                  <span className={styles.customRangeSeparator}>–</span>
                  <input
                    type="datetime-local"
                    className={styles.datetimeInput}
                    value={customToInput}
                    onChange={(e) => handleCustomDateChange(customFromInput, e.target.value)}
                    aria-label={t('usage_stats.custom_to')}
                  />
                </div>
                {customRangeError && (
                  <span className={styles.customRangeError}>{customRangeError}</span>
                )}
              </div>
            )}

            <MultiSelectFilter
              label={t('usage_stats.select_models')}
              selected={globalFilter.models}
              options={modelOptions}
              onChange={(models) => setGlobalFilter((prev) => ({ ...prev, models }))}
              disabled={!connected || disabled}
            />

            <MultiSelectFilter
              label={t('usage_stats.select_providers')}
              selected={globalFilter.providers}
              options={providerOptions}
              onChange={(providers) => setGlobalFilter((prev) => ({ ...prev, providers }))}
              disabled={!connected || disabled}
            />

            <MultiSelectFilter
              label={t('usage_stats.select_keys')}
              selected={globalFilter.apiKeyIds}
              options={apiKeyOptions}
              onChange={(apiKeyIds) => setGlobalFilter((prev) => ({ ...prev, apiKeyIds }))}
              disabled={!connected || disabled}
            />

            <MultiSelectFilter
              label={t('usage_stats.select_credentials')}
              selected={globalFilter.authIndexes}
              options={credentialOptions}
              onChange={(authIndexes) => setGlobalFilter((prev) => ({ ...prev, authIndexes }))}
              disabled={!connected || disabled}
            />
          </div>

          {(activeChips.length > 0 || hasActiveGlobalFilters(globalFilter)) && (
            <div className={styles.chipsRow}>
              {activeChips.map((chip) => (
                <span key={chip.id} className={styles.filterChip}>
                  <span className={styles.chipPrefix}>{chip.dimLabel}:</span>
                  <span className={styles.chipLabel}>{chip.label}</span>
                  <button
                    type="button"
                    className={styles.chipRemove}
                    onClick={() => handleRemoveFilter(chip.dim, chip.value)}
                    aria-label={t('usage_stats.remove_filter')}
                  >
                    <IconX size={12} />
                  </button>
                </span>
              ))}
              <button type="button" className={styles.clearAllBtn} onClick={handleClearAllFilters}>
                {t('usage_stats.filter_clear_all')}
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}

      {disabled ? (
        <div className={styles.panelStack}>
          <EmptyState
            title={t('usage_stats.disabled_title')}
            description={t('usage_stats.disabled_desc')}
            action={
              <Button size="sm" onClick={() => void handleEnable()} loading={enabling}>
                {t('usage_stats.enable')}
              </Button>
            }
          />
          {connected && <StoreSettingsCard onSaved={load} disabled={enabling} />}
        </div>
      ) : loading && !stats ? (
        <div className={styles.cards} aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} height={96} rounded={14} />
          ))}
        </div>
      ) : stats ? (
        // Keyed by tab so each tab cascades in when it opens; refreshes keep it mounted.
        <RevealGroup
          key={tab}
          role="tabpanel"
          id={`usage-panel-${tab}`}
          aria-labelledby={`usage-tab-${tab}`}
          className={styles.panelStack}
        >
          {tab === 'overview' && (
            <OverviewTab
              stats={stats}
              prevStats={prevStats}
              prices={pricing?.models ?? NO_PRICES}
              labels={labels}
              onOpenEvents={handleOpenEventsFromOverview}
              onDrillDown={handleDrillDown}
            />
          )}
          {tab === 'realtime' && <RealtimeTab dimensionFilter={dimensionFilter} labels={labels} />}
          {tab === 'analysis' && (
            <AnalysisTab
              usageWindow={usageWindow}
              stats={stats}
              dimensionFilter={dimensionFilter}
            />
          )}
          {tab === 'quota_value' && (
            <QuotaValueTab
              usageWindow={usageWindow}
              stats={stats}
              authIndexes={dimensionFilter.authIndex}
              providers={dimensionFilter.provider}
              hasIgnoredFilters={
                globalFilter.models.length > 0 || globalFilter.apiKeyIds.length > 0
              }
              labels={labels}
            />
          )}
          {tab === 'events' && (
            <EventsTab
              usageWindow={usageWindow}
              stats={stats}
              globalFilter={globalFilter}
              resultFilter={resultFilter}
              onResultFilterChange={setResultFilter}
              onAddFilter={handleAddFilter}
              labels={labels}
            />
          )}
          {tab === 'pricing' && pricing && (
            <PricingTab pricing={pricing} onPricingChange={setPricing} onReload={load} />
          )}
        </RevealGroup>
      ) : null}
    </div>
  );
}
