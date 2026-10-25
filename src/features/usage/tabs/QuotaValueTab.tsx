import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, Line } from 'react-chartjs-2';
import {
  usageStoreApi,
  type UsageQuotaValueResponse,
  type UsageStats,
} from '@/services/api/usageStore';
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
import { SERIES_COLORS, baseCartesianOptions, useChartTheme } from '../charts';
import { PanelHeading } from '../components/PanelBits';
import { ProviderBadge } from '../components/Labels';
import { RevealGroup } from '../components/Motion';
import { formatCompact, formatCost, formatPercent } from '../format';
import type { UsageLabels } from '../hooks/useUsageLabels';
import {
  MIN_RELIABLE_PERCENT,
  buildQuotaValues,
  formatPeriod,
  isReliableWindow,
  quotaPeriods,
  windowIssue,
} from '../quotaValue';
import type { UsageWindow } from '../UsagePage';
import styles from '../UsagePage.module.scss';

const nullableCost = (value: number | null) => (value === null ? '—' : `≈ ${formatCost(value)}`);
const nullableTokens = (value: number | null) =>
  value === null ? '—' : `≈ ${formatCompact(value)}`;

export function QuotaValueTab({
  usageWindow,
  stats,
  authIndexes,
  providers,
  hasIgnoredFilters,
  labels,
}: {
  usageWindow: UsageWindow;
  stats: UsageStats;
  authIndexes?: string[];
  providers?: string[];
  hasIgnoredFilters?: boolean;
  labels: UsageLabels;
}) {
  const { t, i18n } = useTranslation();
  const theme = useChartTheme();
  const [data, setData] = useState<UsageQuotaValueResponse | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setError('');
    try {
      const next = await usageStoreApi.getQuotaValue(usageWindow.from, usageWindow.to, authIndexes);
      if (requestId === requestRef.current) setData(next);
    } catch (err: unknown) {
      if (requestId === requestRef.current) {
        setError(err instanceof Error ? err.message : t('notification.refresh_failed'));
      }
    }
  }, [authIndexes, t, usageWindow]);

  // `stats` changes on every refresh, so the estimates follow the header refresh too.
  useEffect(() => {
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [load, stats]);

  const filteredWindows = useMemo(() => {
    if (!data) return null;
    if (!providers || providers.length === 0) return data.windows;
    const set = new Set(providers.map((p) => p.toLowerCase()));
    return data.windows.filter((w) => set.has(w.provider.toLowerCase()));
  }, [data, providers]);

  const values = useMemo(
    () => buildQuotaValues(filteredWindows ?? [], data?.models ?? []),
    [filteredWindows, data?.models]
  );
  const periods = useMemo(() => quotaPeriods(values), [values]);
  const name = useCallback((authIndex: string) => labels.credential(authIndex), [labels]);
  const active = values.find((c) => c.authIndex === selected) ?? values[0];

  const dateLabel = useCallback(
    (sec: number) =>
      new Date(sec * 1000).toLocaleString(i18n.language, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [i18n.language]
  );

  const comparison = useMemo(() => {
    const base = baseCartesianOptions(theme, false, formatCost);
    return {
      data: {
        labels: values.map((c) => name(c.authIndex)),
        datasets: periods.map((period, index) => ({
          label: t('usage_stats.quota_value_window', { period: formatPeriod(period) }),
          data: values.map(
            (c) => c.periods.find((p) => p.periodSeconds === period)?.reference?.fullCost ?? null
          ),
          backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length],
          borderRadius: 3,
        })),
      },
      options: base,
    };
  }, [name, periods, t, theme, values]);

  const trends = useMemo(
    () =>
      (active?.periods ?? []).map((p, index) => {
        const base = baseCartesianOptions(theme, false, formatCost);
        const color = SERIES_COLORS[periods.indexOf(p.periodSeconds) % SERIES_COLORS.length];
        const modelFullCost = p.model?.status === 'fitted' ? (p.model.fullCost ?? null) : null;
        return {
          period: p.periodSeconds,
          data: {
            labels: p.history.map((w) => dateLabel(w.startAt)),
            datasets: [
              {
                label: t('usage_stats.quota_value_full_cost'),
                // Unreliable points stay gaps so a 1% window cannot spike the line.
                data: p.history.map((w) => (isReliableWindow(w) ? w.fullCost : null)),
                borderColor: color ?? SERIES_COLORS[index],
                backgroundColor: color ?? SERIES_COLORS[index],
                spanGaps: true,
                tension: 0.25,
              },
              ...(modelFullCost !== null
                ? [
                    {
                      label: t('usage_stats.quota_value_model_line'),
                      data: p.history.map(() => modelFullCost),
                      borderColor: color ?? SERIES_COLORS[index],
                      borderDash: [5, 5],
                      pointRadius: p.history.length < 2 ? 4 : 0,
                      pointHoverRadius: p.history.length < 2 ? 6 : 0,
                      pointStyle: 'rectRot',
                      fill: false,
                    },
                  ]
                : []),
            ],
          },
          options: { ...base, plugins: { ...base.plugins, legend: { display: false } } },
        };
      }),
    [active, dateLabel, periods, t, theme]
  );

  if (error) {
    return (
      <div className={styles.errorBanner} role="alert">
        {error}
      </div>
    );
  }
  if (!data) {
    return <Skeleton height={320} rounded={14} />;
  }
  if (values.length === 0) {
    return (
      <section className={styles.panel}>
        <PanelHeading
          title={t('usage_stats.quota_value_title')}
          desc={t('usage_stats.quota_value_empty')}
        />
        {hasIgnoredFilters && (
          <p className={styles.muted}>{t('usage_stats.quota_value_filters_hint')}</p>
        )}
      </section>
    );
  }

  const history = active
    ? active.periods
        .flatMap((p) => p.history)
        .sort((a, b) => b.resetAt - a.resetAt || a.periodSeconds - b.periodSeconds)
    : [];

  return (
    <RevealGroup className={styles.panelStack}>
      <section className={styles.panel} data-reveal="">
        <PanelHeading
          title={t('usage_stats.quota_value_title')}
          desc={t('usage_stats.quota_value_desc', { percent: MIN_RELIABLE_PERCENT })}
        />
        {hasIgnoredFilters && (
          <p className={styles.muted}>{t('usage_stats.quota_value_filters_hint')}</p>
        )}
        <div
          className={styles.chartBox}
          role="img"
          aria-label={t('usage_stats.quota_value_compare_title')}
        >
          <Bar data={comparison.data} options={comparison.options} />
        </div>
        <Table className={styles.table}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('usage_stats.col_credential')}</TableHead>
              <TableHead>{t('usage_stats.quota_value_col_window')}</TableHead>
              <TableHead alignRight>{t('usage_stats.quota_value_col_used')}</TableHead>
              <TableHead alignRight>{t('usage_stats.quota_value_col_cost')}</TableHead>
              <TableHead alignRight>{t('usage_stats.quota_value_full_cost')}</TableHead>
              <TableHead alignRight>{t('usage_stats.quota_value_full_tokens')}</TableHead>
              <TableHead alignRight>{t('usage_stats.quota_value_col_reset')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {values.flatMap((c) =>
              c.periods.map((p, index) => (
                <TableRow key={`${c.authIndex}:${p.periodSeconds}`}>
                  <TableCell>
                    {index === 0 && (
                      <div className={styles.cellMain}>
                        <span className={styles.cellLine}>
                          <span className={styles.cellStrong}>{name(c.authIndex)}</span>
                          <ProviderBadge provider={c.provider} />
                        </span>
                        {c.ratio !== null && (
                          <span className={styles.cellSub}>
                            {t('usage_stats.quota_value_ratio', {
                              long: formatPeriod(c.periods[c.periods.length - 1].periodSeconds),
                              short: formatPeriod(c.periods[0].periodSeconds),
                              ratio: c.ratio.toFixed(1),
                            })}
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{formatPeriod(p.periodSeconds)}</TableCell>
                  <TableCell alignRight>{formatPercent(p.current.usedPercent, 0)}</TableCell>
                  <TableCell alignRight>{formatCost(p.current.usage.cost)}</TableCell>
                  <TableCell alignRight>
                    {p.reference ? (
                      <div>
                        <span>
                          {nullableCost(p.reference.fullCost)}
                          {p.reference.source === 'model' && p.reference.ciPercent !== null && (
                            <span> ±{Math.round(p.reference.ciPercent)}%</span>
                          )}
                        </span>
                        {p.reference.source === 'model' && p.model && (
                          <span className={styles.cellSub}>
                            {t('usage_stats.quota_value_model_basis', {
                              windows: p.model.windows,
                              segments: p.model.segments,
                            })}
                          </span>
                        )}
                        {p.reference.source === 'window' &&
                          p.estimate &&
                          p.estimate.externalPercent >= 1 && (
                            <span className={styles.cellSub}>
                              {t('usage_stats.quota_value_external_deducted', {
                                percent: Math.round(p.estimate.externalPercent),
                              })}
                            </span>
                          )}
                      </div>
                    ) : (
                      <span className={styles.muted}>
                        {windowIssue(p.current) === 'unpriced'
                          ? t('usage_stats.quota_value_unpriced')
                          : t('usage_stats.quota_value_need_more', {
                              percent: MIN_RELIABLE_PERCENT,
                            })}
                      </span>
                    )}
                  </TableCell>
                  <TableCell alignRight>
                    {nullableTokens(
                      p.reference?.tokens ??
                        (windowIssue(p.current) === 'unpriced' ? p.current.fullTokens : null)
                    )}
                  </TableCell>
                  <TableCell alignRight>{dateLabel(p.current.resetAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>

      <section className={styles.panel} data-reveal="">
        <div className={styles.panelHeader}>
          <PanelHeading
            title={t('usage_stats.quota_value_trend_title')}
            desc={t('usage_stats.quota_value_trend_desc')}
          />
          <Select
            value={active?.authIndex ?? ''}
            options={values.map((c) => ({ value: c.authIndex, label: name(c.authIndex) }))}
            onChange={setSelected}
            ariaLabel={t('usage_stats.select_credentials')}
            size="sm"
            className={styles.rangeSelect}
          />
        </div>
        <div className={styles.split}>
          {trends.map((trend) => (
            <div key={trend.period}>
              <h3 className={styles.panelDesc}>
                {t('usage_stats.quota_value_window', { period: formatPeriod(trend.period) })}
              </h3>
              <div
                className={styles.chartBoxSmall}
                role="img"
                aria-label={t('usage_stats.quota_value_window', {
                  period: formatPeriod(trend.period),
                })}
              >
                <Line data={trend.data} options={trend.options} />
              </div>
            </div>
          ))}
        </div>
        <Table className={styles.table}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('usage_stats.quota_value_col_window')}</TableHead>
              <TableHead>{t('usage_stats.quota_value_col_start')}</TableHead>
              <TableHead alignRight>{t('usage_stats.quota_value_col_used')}</TableHead>
              <TableHead alignRight>{t('usage_stats.quota_value_col_cost')}</TableHead>
              <TableHead alignRight>{t('usage_stats.metric_tokens')}</TableHead>
              <TableHead alignRight>{t('usage_stats.quota_value_full_cost')}</TableHead>
              <TableHead alignRight>{t('usage_stats.quota_value_full_tokens')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((w) => {
              const issue = windowIssue(w);
              return (
                <TableRow key={`${w.periodSeconds}:${w.resetAt}`}>
                  <TableCell>{formatPeriod(w.periodSeconds)}</TableCell>
                  <TableCell>
                    {dateLabel(w.startAt)}
                    {w.partial && (
                      <span className={styles.cellSub}>
                        {' '}
                        {t('usage_stats.quota_value_partial')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell alignRight>{formatPercent(w.usedPercent, 0)}</TableCell>
                  <TableCell alignRight>{formatCost(w.usage.cost)}</TableCell>
                  <TableCell alignRight>{formatCompact(w.usage.tokens.total)}</TableCell>
                  <TableCell alignRight className={issue ? styles.muted : undefined}>
                    {issue === 'unpriced' ? (
                      t('usage_stats.quota_value_unpriced')
                    ) : issue === 'low' ? (
                      t('usage_stats.quota_value_need_more', {
                        percent: MIN_RELIABLE_PERCENT,
                      })
                    ) : (
                      <div>
                        <span>{nullableCost(w.fullCost)}</span>
                        {w.externalPercent >= 1 && (
                          <span className={styles.cellSub}>
                            {t('usage_stats.quota_value_external_deducted', {
                              percent: Math.round(w.externalPercent),
                            })}
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell alignRight className={issue === 'low' ? styles.muted : undefined}>
                    {issue === 'low' ? '—' : nullableTokens(w.fullTokens)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      <section className={styles.panel} data-reveal="">
        <PanelHeading
          title={t('usage_stats.quota_value_coeff_title')}
          desc={t('usage_stats.quota_value_coeff_desc')}
        />
        {active?.periods.map((p) => (
          <div key={p.periodSeconds} className={styles.panelStack}>
            <h3 className={styles.panelDesc}>
              {t('usage_stats.quota_value_window', { period: formatPeriod(p.periodSeconds) })}
            </h3>
            {p.model?.status === 'fitted' && p.model.features.length > 0 ? (
              <div className={styles.split}>
                <Table className={styles.table}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('usage_stats.col_model')}</TableHead>
                      <TableHead>{t('usage_stats.quota_value_col_kind')}</TableHead>
                      <TableHead alignRight>
                        {t('usage_stats.quota_value_col_multiplier')}
                      </TableHead>
                      <TableHead alignRight>{t('usage_stats.quota_value_col_share')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {p.model.features.map((f, i) => (
                      <TableRow key={i}>
                        <TableCell className={styles.mono}>
                          {f.model || t('usage_stats.quota_value_kind_other')}
                        </TableCell>
                        <TableCell>
                          {t(`usage_stats.quota_value_kind_${f.kind}`, { defaultValue: f.kind })}
                        </TableCell>
                        <TableCell alignRight>{f.multiplier.toFixed(2)}×</TableCell>
                        <TableCell alignRight>{f.share.toFixed(1)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {p.model.modelValues.length > 0 ? (
                  <div>
                    <h4 className={styles.panelDesc}>
                      {t('usage_stats.quota_value_model_values')}
                    </h4>
                    <Table className={styles.table}>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('usage_stats.col_model')}</TableHead>
                          <TableHead alignRight>{t('usage_stats.quota_value_full_cost')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {p.model.modelValues.map((mv) => (
                          <TableRow key={mv.model}>
                            <TableCell className={styles.mono}>{mv.model}</TableCell>
                            <TableCell alignRight>{nullableCost(mv.fullCost)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className={styles.muted}>{t('usage_stats.quota_value_model_insufficient')}</p>
            )}
          </div>
        ))}
      </section>
    </RevealGroup>
  );
}
