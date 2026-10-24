import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  usageStoreApi,
  type UsageGeoipStatus,
  type UsageStoreSettings,
} from '@/services/api/usageStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useConfigStore, useNotificationStore } from '@/stores';
import {
  isStoreSettingsDirty,
  parseStoreSettingsDraft,
  toStoreSettingsDraft,
  type StoreSettingsDraft,
} from '../logic';
import styles from '../UsagePage.module.scss';

const RELOAD_SETTLE_MS = 1200;

const EMPTY_DRAFT: StoreSettingsDraft = {
  enable: false,
  path: '',
  retentionDays: '',
  disableModelsDev: false,
  disableGeoip: false,
};

export function StoreSettingsCard({
  onSaved,
  disabled: externalDisabled = false,
  initialSettings,
}: {
  onSaved: () => Promise<void>;
  disabled?: boolean;
  initialSettings?: UsageStoreSettings;
}) {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const enableHintId = useId();
  const modelsDevHintId = useId();
  const geoipHintId = useId();

  const [saved, setSaved] = useState<UsageStoreSettings | null>(initialSettings ?? null);
  const [draft, setDraft] = useState<StoreSettingsDraft>(() =>
    initialSettings ? toStoreSettingsDraft(initialSettings) : EMPTY_DRAFT
  );
  const [geoipStatus, setGeoipStatus] = useState<UsageGeoipStatus | null>(null);
  const [refreshingGeoip, setRefreshingGeoip] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retentionInvalid, setRetentionInvalid] = useState(false);

  const mountedRef = useRef(true);
  const loadRequestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestRef.current += 1;
    };
  }, []);

  const loadSettings = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    try {
      const [next, geoStatus] = await Promise.all([
        usageStoreApi.getSettings(),
        usageStoreApi.getGeoipStatus().catch(() => null),
      ]);
      if (requestId !== loadRequestRef.current || !mountedRef.current) return;
      setSaved(next);
      setDraft(toStoreSettingsDraft(next));
      setGeoipStatus(geoStatus);
      setRetentionInvalid(false);
    } catch (err: unknown) {
      if (requestId !== loadRequestRef.current || !mountedRef.current) return;
      showNotification(
        err instanceof Error && err.message ? err.message : t('notification.refresh_failed'),
        'error'
      );
    }
  }, [showNotification, t]);

  useEffect(() => {
    if (initialSettings) return;
    void loadSettings();
  }, [initialSettings, loadSettings]);

  const performSave = async (next: UsageStoreSettings, previous: UsageStoreSettings) => {
    if (mountedRef.current) setSaving(true);
    try {
      await usageStoreApi.saveSettings(next, previous);
      useConfigStore.getState().clearCache();
      showNotification(t('usage_stats.store_settings_saved'), 'success');
      // Give the async config reload a moment before re-reading runtime state.
      await new Promise((resolve) => setTimeout(resolve, RELOAD_SETTLE_MS));
      await onSaved();
      if (mountedRef.current) {
        await loadSettings();
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      showNotification(
        err instanceof Error && err.message ? err.message : t('notification.update_failed'),
        'error'
      );
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const handleRefreshGeoip = async () => {
    if (refreshingGeoip || controlsDisabled) return;
    setRefreshingGeoip(true);
    try {
      const next = await usageStoreApi.refreshGeoip();
      setGeoipStatus(next);
      showNotification(t('usage_stats.store_geoip_refreshed'), 'success');
    } catch (err: unknown) {
      showNotification(
        err instanceof Error && err.message ? err.message : t('notification.refresh_failed'),
        'error'
      );
    } finally {
      if (mountedRef.current) setRefreshingGeoip(false);
    }
  };

  const handleSave = () => {
    if (!saved || saving || externalDisabled) return;
    const parsed = parseStoreSettingsDraft(draft);
    if ('error' in parsed) {
      setRetentionInvalid(true);
      showNotification(t('usage_stats.store_retention_invalid'), 'error');
      return;
    }
    if (!isStoreSettingsDirty(draft, saved)) return;

    if (saved.enable && !parsed.settings.enable) {
      showConfirmation({
        title: t('usage_stats.store_disable_title'),
        message: t('usage_stats.store_disable_confirm'),
        confirmText: t('usage_stats.store_disable_action'),
        variant: 'danger',
        onConfirm: () => performSave(parsed.settings, saved),
      });
      return;
    }

    void performSave(parsed.settings, saved);
  };

  const handleReset = () => {
    if (!saved) return;
    setDraft(toStoreSettingsDraft(saved));
    setRetentionInvalid(false);
  };

  const onInputKeyDown = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'Enter') handleSave();
  };

  const loaded = saved !== null;
  const dirty = loaded && isStoreSettingsDirty(draft, saved);
  const controlsDisabled = !loaded || saving || externalDisabled;

  return (
    <section className={styles.panel} data-reveal="">
      <div className={styles.panelHeader}>
        <div className={styles.panelHeading}>
          <h2 className={styles.panelTitle}>{t('usage_stats.store_settings_title')}</h2>
          <p className={styles.panelDesc}>{t('usage_stats.store_settings_desc')}</p>
        </div>
        <div className={styles.toolbarActions}>
          {dirty && (
            <Button variant="secondary" size="sm" onClick={handleReset} disabled={controlsDisabled}>
              {t('common.cancel')}
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            loading={saving}
            disabled={controlsDisabled || !dirty}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>

      <div className={styles.settingsGrid}>
        <div className={styles.settingToggleBox}>
          <ToggleSwitch
            checked={draft.enable}
            onChange={(enable) => setDraft((prev) => ({ ...prev, enable }))}
            label={t('usage_stats.enable')}
            ariaDescribedBy={enableHintId}
            disabled={controlsDisabled}
          />
          <p id={enableHintId} className={styles.settingHint}>
            {t('usage_stats.store_enable_hint')}
          </p>
        </div>

        <div className={styles.settingToggleBox}>
          <ToggleSwitch
            checked={draft.disableModelsDev}
            onChange={(disableModelsDev) => setDraft((prev) => ({ ...prev, disableModelsDev }))}
            label={t('usage_stats.store_disable_models_dev')}
            ariaDescribedBy={modelsDevHintId}
            disabled={controlsDisabled}
          />
          <p id={modelsDevHintId} className={styles.settingHint}>
            {t('usage_stats.store_disable_models_dev_hint')}
          </p>
        </div>

        <div className={styles.settingToggleBox}>
          <ToggleSwitch
            checked={draft.disableGeoip}
            onChange={(disableGeoip) => setDraft((prev) => ({ ...prev, disableGeoip }))}
            label={t('usage_stats.store_disable_geoip')}
            ariaDescribedBy={geoipHintId}
            disabled={controlsDisabled}
          />
          <p id={geoipHintId} className={styles.settingHint}>
            {t('usage_stats.store_disable_geoip_hint')}
          </p>
          {geoipStatus && (
            <div className={styles.geoipStatusRow}>
              <span className={styles.settingHint}>
                {t('usage_stats.store_geoip_status', {
                  resolved: geoipStatus.resolved,
                  pending: geoipStatus.pending,
                  time: geoipStatus.lastLookupAt
                    ? new Date(geoipStatus.lastLookupAt).toLocaleString(i18n.language)
                    : '—',
                })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                loading={refreshingGeoip}
                disabled={controlsDisabled || draft.disableGeoip || geoipStatus.pending === 0}
                onClick={() => void handleRefreshGeoip()}
              >
                {t('usage_stats.store_geoip_refresh')}
              </Button>
            </div>
          )}
          {geoipStatus?.lastError && <p className={styles.errorText}>{geoipStatus.lastError}</p>}
          <p className={styles.settingHint}>
            {t('usage_stats.store_geoip_source')}{' '}
            <a
              href="https://ip.sb/api/"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.attributionLink}
            >
              ip.sb
            </a>
          </p>
        </div>

        <Input
          label={t('usage_stats.store_retention_label')}
          inputMode="numeric"
          value={draft.retentionDays}
          placeholder="30"
          hint={t('usage_stats.store_retention_hint')}
          error={retentionInvalid ? t('usage_stats.store_retention_invalid') : undefined}
          disabled={controlsDisabled}
          onChange={(ev) => {
            setRetentionInvalid(false);
            setDraft((prev) => ({ ...prev, retentionDays: ev.target.value }));
          }}
          onKeyDown={onInputKeyDown}
        />

        <Input
          label={t('usage_stats.store_path_label')}
          className={styles.mono}
          value={draft.path}
          placeholder="usage.db"
          hint={t('usage_stats.store_path_hint')}
          disabled={controlsDisabled}
          onChange={(ev) => setDraft((prev) => ({ ...prev, path: ev.target.value }))}
          onKeyDown={onInputKeyDown}
        />
      </div>
    </section>
  );
}
