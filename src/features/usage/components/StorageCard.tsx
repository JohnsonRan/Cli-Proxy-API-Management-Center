import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usageStoreApi, type UsageStorageStatus } from '@/services/api/usageStore';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useInterval } from '@/hooks/useInterval';
import { useNotificationStore } from '@/stores';
import { formatFileSize } from '@/utils/format';
import { formatCompact } from '../format';
import { parseKeepDays } from '../logic';
import styles from '../UsagePage.module.scss';

const POLL_MS = 2000;

const errorText = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

export function StorageCard({
  initialStatus,
  disabled: externalDisabled = false,
}: {
  initialStatus?: UsageStorageStatus;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  // undefined while loading, null when the core has no storage endpoint.
  const [status, setStatus] = useState<UsageStorageStatus | null | undefined>(initialStatus);
  const [keepDays, setKeepDays] = useState('');
  const [keepInvalid, setKeepInvalid] = useState(false);
  const [starting, setStarting] = useState(false);
  const mountedRef = useRef(true);
  const wasRunning = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await usageStoreApi.getStorage();
      if (!mountedRef.current) return;
      setStatus(next);
      // Report the result once when a run this card saw finishes.
      if (wasRunning.current && next && !next.optimize.running) {
        const o = next.optimize;
        if (o.error) showNotification(o.error, 'error');
        else
          showNotification(
            t('usage_stats.storage_optimize_done', {
              before: formatFileSize(o.beforeBytes),
              after: formatFileSize(o.afterBytes),
            }),
            'success'
          );
      }
      wasRunning.current = next?.optimize.running ?? false;
    } catch (err: unknown) {
      if (mountedRef.current)
        showNotification(errorText(err, t('notification.refresh_failed')), 'error');
    }
  }, [showNotification, t]);

  useEffect(() => {
    if (initialStatus) return;
    void load();
  }, [initialStatus, load]);

  const running = status?.optimize.running ?? false;
  const controlsDisabled = externalDisabled || running || starting;
  useInterval(() => void load(), running ? POLL_MS : null);

  if (!status) return null;

  const start = async (days: number) => {
    setStarting(true);
    try {
      const next = await usageStoreApi.optimizeStorage(days);
      if (!mountedRef.current) return;
      wasRunning.current = true;
      setStatus(next);
    } catch (err: unknown) {
      showNotification(errorText(err, t('notification.update_failed')), 'error');
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  };

  const handleOptimize = () => {
    if (controlsDisabled) return;
    const days = parseKeepDays(keepDays);
    if (days === null) {
      setKeepInvalid(true);
      return;
    }
    showConfirmation({
      title: t('usage_stats.storage_optimize_title'),
      message:
        days > 0
          ? t('usage_stats.storage_optimize_confirm_trim', { days })
          : t('usage_stats.storage_optimize_confirm'),
      confirmText: t('usage_stats.storage_optimize'),
      variant: days > 0 ? 'danger' : 'primary',
      onConfirm: () => start(days),
    });
  };

  const date = (ms: number) => new Date(ms).toLocaleString(i18n.language);
  const o = status.optimize;
  const items = [
    {
      key: 'size',
      label: t('usage_stats.storage_size'),
      value: formatFileSize(status.fileBytes + status.walBytes),
      sub: status.path,
      mono: true,
    },
    {
      key: 'free',
      label: t('usage_stats.storage_free'),
      value: formatFileSize(status.freeBytes),
      sub: t('usage_stats.storage_free_sub'),
    },
    {
      key: 'events',
      label: t('usage_stats.storage_events'),
      value: formatCompact(status.events),
      sub: status.oldestEvent
        ? t('usage_stats.storage_oldest', { time: date(status.oldestEvent) })
        : t('usage_stats.no_data'),
    },
    {
      key: 'growth',
      label: t('usage_stats.storage_growth'),
      value: t('usage_stats.storage_per_day', { size: formatFileSize(status.growthBytesPerDay) }),
      sub: t('usage_stats.storage_growth_sub', { count: Math.round(status.eventsPerDay) }),
    },
  ];

  return (
    <section className={styles.panel} data-reveal="">
      <div className={styles.panelHeader}>
        <div className={styles.panelHeading}>
          <h2 className={styles.panelTitle}>{t('usage_stats.storage_title')}</h2>
          <p className={styles.panelDesc}>{t('usage_stats.storage_desc')}</p>
        </div>
      </div>

      <div className={styles.summaryStrip}>
        {items.map((item) => (
          <Card key={item.key} className={styles.summaryItem}>
            <span className={styles.summaryLabel}>{item.label}</span>
            <span className={styles.summaryValue}>{item.value}</span>
            <span
              className={item.mono ? `${styles.summarySub} ${styles.mono}` : styles.summarySub}
              title={item.sub}
            >
              {item.sub}
            </span>
          </Card>
        ))}
      </div>

      <div className={styles.settingsGrid}>
        <Input
          label={t('usage_stats.storage_keep_days')}
          inputMode="numeric"
          value={keepDays}
          placeholder={status.retentionDays > 0 ? String(status.retentionDays) : ''}
          hint={t('usage_stats.storage_keep_days_hint')}
          error={keepInvalid ? t('usage_stats.storage_keep_days_invalid') : undefined}
          disabled={controlsDisabled}
          onChange={(ev) => {
            setKeepInvalid(false);
            setKeepDays(ev.target.value);
          }}
        />
        <div className={styles.settingToggleBox}>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleOptimize}
            loading={running || starting}
            disabled={controlsDisabled}
          >
            {running ? t('usage_stats.storage_optimizing') : t('usage_stats.storage_optimize')}
          </Button>
          <p className={styles.settingHint}>{t('usage_stats.storage_optimize_hint')}</p>
          {!running && o.finishedAt > 0 && (
            <p className={o.error ? styles.errorText : styles.settingHint} role="status">
              {o.error
                ? t('usage_stats.storage_last_error', { time: date(o.finishedAt), error: o.error })
                : t('usage_stats.storage_last_result', {
                    time: date(o.finishedAt),
                    before: formatFileSize(o.beforeBytes),
                    after: formatFileSize(o.afterBytes),
                    count: o.deletedEvents,
                  })}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
