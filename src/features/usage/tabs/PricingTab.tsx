import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usageStoreApi, type UsagePricing } from '@/services/api/usageStore';
import { Button } from '@/components/ui/Button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { useNotificationStore } from '@/stores';
import { PRICE_FIELDS, emptyRow, parseDraftRows, toDraft, type DraftRow } from '../logic';
import { PanelHeading } from '../components/PanelBits';
import styles from '../UsagePage.module.scss';

export function PricingTab({
  pricing,
  onPricingChange,
  onReload,
}: {
  pricing: UsagePricing;
  onPricingChange: (pricing: UsagePricing) => void;
  onReload: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [invalidRow, setInvalidRow] = useState<number | null>(null);

  const loadOverrides = useCallback(async () => {
    try {
      const overrides = await usageStoreApi.getOverrides();
      setRows(overrides.map(toDraft));
      setDirty(false);
      setInvalidRow(null);
    } catch (err: unknown) {
      showNotification(
        err instanceof Error ? err.message : t('notification.refresh_failed'),
        'error'
      );
      setRows([]);
    }
  }, [showNotification, t]);

  useEffect(() => {
    void loadOverrides();
  }, [loadOverrides]);

  const update = (index: number, patch: Partial<DraftRow>) => {
    setRows((prev) => (prev ?? []).map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setDirty(true);
    setInvalidRow(null);
  };

  const addRow = (seed?: Partial<DraftRow>) => {
    setRows((prev) => [...(prev ?? []), { ...emptyRow(), ...seed }]);
    setDirty(true);
  };

  const save = async () => {
    const parsed = parseDraftRows(rows ?? []);
    if ('invalidRow' in parsed) {
      setInvalidRow(parsed.invalidRow);
      showNotification(t('usage_stats.override_invalid', { row: parsed.invalidRow + 1 }), 'error');
      return;
    }
    setSaving(true);
    try {
      await usageStoreApi.saveOverrides(parsed.overrides);
      showNotification(t('usage_stats.override_saved'), 'success');
      setDirty(false);
      // Give the config watcher a moment before re-reading effective prices.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      onPricingChange(await usageStoreApi.getPricing());
      await onReload();
      await loadOverrides();
    } catch (err: unknown) {
      showNotification(
        err instanceof Error ? err.message : t('notification.update_failed'),
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  const refreshModelsDev = async () => {
    setRefreshing(true);
    try {
      onPricingChange(await usageStoreApi.refreshPricing());
      await onReload();
    } catch (err: unknown) {
      showNotification(
        err instanceof Error ? err.message : t('notification.refresh_failed'),
        'error'
      );
    } finally {
      setRefreshing(false);
    }
  };

  const overridden = new Set((rows ?? []).map((r) => r.model.trim().toLowerCase()));
  const md = pricing.modelsDev;
  const price = (value: number | undefined) => (value === undefined ? '—' : `$${value}`);

  return (
    <>
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <PanelHeading
            title={t('usage_stats.overrides_title')}
            desc={t('usage_stats.overrides_hint')}
          />
          <div className={styles.toolbarActions}>
            <Button variant="secondary" size="sm" onClick={() => addRow()} disabled={rows === null}>
              {t('usage_stats.override_add')}
            </Button>
            <Button size="sm" onClick={() => void save()} loading={saving} disabled={!dirty}>
              {t('usage_stats.override_save')}
            </Button>
          </div>
        </div>
        {rows && rows.length > 0 ? (
          <Table className={styles.table}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('usage_stats.col_model')}</TableHead>
                <TableHead>{t('usage_stats.col_price_input')}</TableHead>
                <TableHead>{t('usage_stats.col_price_output')}</TableHead>
                <TableHead>{t('usage_stats.col_price_cache_read')}</TableHead>
                <TableHead>{t('usage_stats.col_price_cache_write')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow
                  key={index}
                  className={invalidRow === index ? styles.invalidRow : undefined}
                >
                  <TableCell>
                    <input
                      className={styles.cellInput}
                      list="usage-model-options"
                      value={row.model}
                      placeholder="gpt-5"
                      aria-label={t('usage_stats.col_model')}
                      onChange={(e) => update(index, { model: e.target.value })}
                    />
                  </TableCell>
                  {PRICE_FIELDS.map((field) => (
                    <TableCell key={field}>
                      <input
                        className={styles.cellInputNumber}
                        inputMode="decimal"
                        value={row[field]}
                        placeholder={
                          field === 'cacheRead' || field === 'cacheWrite'
                            ? t('usage_stats.default_input')
                            : '0'
                        }
                        aria-label={t(
                          `usage_stats.col_price_${field === 'cacheRead' ? 'cache_read' : field === 'cacheWrite' ? 'cache_write' : field}`
                        )}
                        onChange={(e) => update(index, { [field]: e.target.value })}
                      />
                    </TableCell>
                  ))}
                  <TableCell alignRight>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setRows((prev) => (prev ?? []).filter((_, i) => i !== index));
                        setDirty(true);
                      }}
                    >
                      {t('usage_stats.override_remove')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className={styles.muted}>{rows === null ? '…' : t('usage_stats.overrides_empty')}</p>
        )}
        <datalist id="usage-model-options">
          {pricing.models.map((m) => (
            <option key={m.model} value={m.model} />
          ))}
        </datalist>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>{t('usage_stats.pricing_title')}</h2>
            <p className={styles.panelDesc}>
              {!md.enabled
                ? t('usage_stats.pricing_models_dev_off')
                : md.updatedAt
                  ? t('usage_stats.pricing_models_dev_status', {
                      count: md.count,
                      time: new Date(md.updatedAt).toLocaleString(i18n.language),
                    })
                  : t('usage_stats.pricing_models_dev_pending')}
            </p>
            {md.lastError && <p className={styles.errorText}>{md.lastError}</p>}
          </div>
          <Button
            variant="secondary"
            size="sm"
            loading={refreshing}
            disabled={!md.enabled}
            onClick={() => void refreshModelsDev()}
          >
            {t('usage_stats.pricing_refresh')}
          </Button>
        </div>
        {pricing.models.length === 0 ? (
          <p className={styles.muted}>{t('usage_stats.no_data')}</p>
        ) : (
          <Table className={styles.table}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('usage_stats.col_model')}</TableHead>
                <TableHead>{t('usage_stats.col_source')}</TableHead>
                <TableHead alignRight>{t('usage_stats.col_price_input')}</TableHead>
                <TableHead alignRight>{t('usage_stats.col_price_output')}</TableHead>
                <TableHead alignRight>{t('usage_stats.col_price_cache_read')}</TableHead>
                <TableHead alignRight>{t('usage_stats.col_price_cache_write')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pricing.models.map((m) => (
                <TableRow key={m.model}>
                  <TableCell className={styles.mono}>{m.model}</TableCell>
                  <TableCell>
                    {m.source === 'override' ? (
                      t('usage_stats.source_override')
                    ) : m.source ? (
                      'models.dev'
                    ) : (
                      <span className={styles.muted}>{t('usage_stats.unpriced')}</span>
                    )}
                  </TableCell>
                  <TableCell alignRight>{price(m.price?.input)}</TableCell>
                  <TableCell alignRight>{price(m.price?.output)}</TableCell>
                  <TableCell alignRight>{price(m.price?.cacheRead)}</TableCell>
                  <TableCell alignRight>{price(m.price?.cacheWrite)}</TableCell>
                  <TableCell alignRight>
                    {!overridden.has(m.model.toLowerCase()) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          addRow({
                            model: m.model,
                            input: m.price ? String(m.price.input) : '',
                            output: m.price ? String(m.price.output) : '',
                            cacheRead: m.price ? String(m.price.cacheRead) : '',
                            cacheWrite: m.price ? String(m.price.cacheWrite) : '',
                          })
                        }
                      >
                        {t('usage_stats.override_this')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </>
  );
}
