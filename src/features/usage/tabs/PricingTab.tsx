import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  usageStoreApi,
  type UsagePriceOverride,
  type UsagePricing,
} from '@/services/api/usageStore';
import { Button } from '@/components/ui/Button';
import { IconCheck, IconPencil, IconPlus, IconTrash2, IconX } from '@/components/ui/icons';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { useConfigStore, useNotificationStore } from '@/stores';
import {
  PRICE_FIELDS,
  emptyRow,
  parseDraftRows,
  pricingRows,
  replaceOverride,
  toDraft,
  type DraftRow,
  type PricingRow,
} from '../logic';
import styles from '../UsagePage.module.scss';

/** The row being edited: an existing model, or a new override when `model` is empty. */
interface Editing {
  model: string;
  draft: DraftRow;
  invalid: boolean;
}

const priceLabelKey = (field: (typeof PRICE_FIELDS)[number]) =>
  `usage_stats.col_price_${field === 'cacheRead' ? 'cache_read' : field === 'cacheWrite' ? 'cache_write' : field}`;

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
  const [overrides, setOverrides] = useState<UsagePriceOverride[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadOverrides = useCallback(async () => {
    try {
      setOverrides(await usageStoreApi.getOverrides());
    } catch (err: unknown) {
      showNotification(
        err instanceof Error ? err.message : t('notification.refresh_failed'),
        'error'
      );
    }
  }, [showNotification, t]);

  useEffect(() => {
    void loadOverrides();
  }, [loadOverrides]);

  const persist = async (next: UsagePriceOverride[]) => {
    setSaving(true);
    try {
      await usageStoreApi.saveOverrides(next);
      useConfigStore.getState().clearCache();
      showNotification(t('usage_stats.override_saved'), 'success');
      setOverrides(next);
      setEditing(null);
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

  const startEdit = (row: PricingRow) =>
    setEditing({
      model: row.model,
      invalid: false,
      draft: row.override
        ? toDraft(row.override)
        : {
            model: row.model,
            input: row.price ? String(row.price.input) : '',
            output: row.price ? String(row.price.output) : '',
            cacheRead: row.price ? String(row.price.cacheRead) : '',
            cacheWrite: row.price ? String(row.price.cacheWrite) : '',
          },
    });

  const saveEdit = () => {
    if (!editing || overrides === null) return;
    const parsed = parseDraftRows([editing.draft]);
    if ('invalidRow' in parsed || parsed.overrides.length !== 1) {
      setEditing({ ...editing, invalid: true });
      showNotification(t('usage_stats.override_invalid'), 'error');
      return;
    }
    void persist(replaceOverride(overrides, editing.model, parsed.overrides[0]));
  };

  const updateDraft = (patch: Partial<DraftRow>) =>
    setEditing((prev) =>
      prev ? { ...prev, invalid: false, draft: { ...prev.draft, ...patch } } : prev
    );

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

  const rows = pricingRows(pricing.models, overrides ?? []);
  const md = pricing.modelsDev;
  const price = (value: number | undefined) => (value === undefined ? '—' : `$${value}`);
  const busy = saving || overrides === null;

  const onEditKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'Enter') saveEdit();
    if (ev.key === 'Escape') setEditing(null);
  };

  const editCells = (e: Editing) => (
    <>
      {PRICE_FIELDS.map((field) => (
        <TableCell key={field} alignRight>
          <input
            className={styles.cellInputNumber}
            inputMode="decimal"
            value={e.draft[field]}
            placeholder={
              field === 'cacheRead' || field === 'cacheWrite' ? t('usage_stats.default_input') : '0'
            }
            aria-label={t(priceLabelKey(field))}
            onChange={(ev) => updateDraft({ [field]: ev.target.value })}
            onKeyDown={onEditKey}
          />
        </TableCell>
      ))}
      <TableCell alignRight>
        <span className={styles.iconActions}>
          <IconButton label={t('common.save')} onClick={saveEdit} loading={saving}>
            <IconCheck size={14} />
          </IconButton>
          <IconButton label={t('common.cancel')} onClick={() => setEditing(null)} disabled={saving}>
            <IconX size={14} />
          </IconButton>
        </span>
      </TableCell>
    </>
  );

  const adding = editing !== null && editing.model === '';

  return (
    <section className={styles.panel} data-reveal="">
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
          <p className={styles.panelDesc}>{t('usage_stats.overrides_hint')}</p>
          {md.lastError && <p className={styles.errorText}>{md.lastError}</p>}
        </div>
        <div className={styles.toolbarActions}>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || adding}
            onClick={() => setEditing({ model: '', draft: emptyRow(), invalid: false })}
          >
            <span className={styles.iconLabel}>
              <IconPlus size={14} />
              {t('usage_stats.override_add')}
            </span>
          </Button>
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
      </div>
      {rows.length === 0 && !adding ? (
        <p className={styles.muted}>{t('usage_stats.no_data')}</p>
      ) : (
        <Table className={styles.table}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('usage_stats.col_model')}</TableHead>
              <TableHead>{t('usage_stats.col_source')}</TableHead>
              {PRICE_FIELDS.map((field) => (
                <TableHead key={field} alignRight>
                  {t(priceLabelKey(field))}
                </TableHead>
              ))}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {adding && editing && (
              <TableRow className={editing.invalid ? styles.invalidRow : undefined}>
                <TableCell>
                  <input
                    className={styles.cellInput}
                    value={editing.draft.model}
                    placeholder="gpt-5"
                    aria-label={t('usage_stats.col_model')}
                    autoFocus
                    onChange={(ev) => updateDraft({ model: ev.target.value })}
                    onKeyDown={onEditKey}
                  />
                </TableCell>
                <TableCell>{t('usage_stats.source_override')}</TableCell>
                {editCells(editing)}
              </TableRow>
            )}
            {rows.map((row) => {
              const isEditing = editing !== null && editing.model === row.model;
              return (
                <TableRow
                  key={row.model}
                  className={isEditing && editing.invalid ? styles.invalidRow : undefined}
                >
                  <TableCell className={styles.mono}>{row.model}</TableCell>
                  <TableCell>
                    {row.override ? (
                      <span className={styles.overrideTag}>{t('usage_stats.source_override')}</span>
                    ) : row.source ? (
                      'models.dev'
                    ) : (
                      <span className={styles.muted}>{t('usage_stats.unpriced')}</span>
                    )}
                  </TableCell>
                  {isEditing ? (
                    editCells(editing)
                  ) : (
                    <>
                      <TableCell alignRight>{price(row.price?.input)}</TableCell>
                      <TableCell alignRight>{price(row.price?.output)}</TableCell>
                      <TableCell alignRight>{price(row.price?.cacheRead)}</TableCell>
                      <TableCell alignRight>{price(row.price?.cacheWrite)}</TableCell>
                      <TableCell alignRight>
                        <span className={styles.iconActions}>
                          <IconButton
                            label={t(
                              row.override
                                ? 'usage_stats.override_edit'
                                : 'usage_stats.override_this',
                              { model: row.model }
                            )}
                            onClick={() => startEdit(row)}
                            disabled={busy || editing !== null}
                          >
                            <IconPencil size={14} />
                          </IconButton>
                          {row.override && (
                            <IconButton
                              label={t('usage_stats.override_remove', { model: row.model })}
                              onClick={() =>
                                overrides &&
                                void persist(replaceOverride(overrides, row.model, null))
                              }
                              disabled={busy || editing !== null}
                            >
                              <IconTrash2 size={14} />
                            </IconButton>
                          )}
                        </span>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function IconButton({
  label,
  children,
  ...rest
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={styles.iconButton}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </Button>
  );
}
