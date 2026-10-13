import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiKeysCardEditor } from '@/features/config/components/blocks/ApiKeysCardEditor';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { IconKey, IconRefreshCw } from '@/components/ui/icons';
import { apiKeysApi } from '@/services/api/apiKeys';
import { useConfigStore, useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import styles from './ApiKeysPage.module.scss';

export function ApiKeysPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const [keysText, setKeysText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    try {
      const keys = await apiKeysApi.list();
      setKeysText(keys.join('\n'));
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const handleKeysChange = useCallback(
    async (nextValue: string) => {
      setKeysText(nextValue);
      const keysArray = nextValue
        .split('\n')
        .map((k) => k.trim())
        .filter(Boolean);
      setSaving(true);
      try {
        await apiKeysApi.replace(keysArray);
        await fetchConfig(true);
        showNotification(t('common.saved_success', '保存成功'), 'success');
      } catch (err) {
        showNotification(getErrorMessage(err), 'error');
      } finally {
        setSaving(false);
      }
    },
    [fetchConfig, showNotification, t]
  );

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerTitleRow}>
          <div className={styles.iconBadge}>
            <IconKey size={22} />
          </div>
          <div>
            <h1 className={styles.title}>{t('nav.api_keys')}</h1>
            <p className={styles.description}>{t('nav_meta.api_keys')}</p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={loading || saving}
          onClick={() => void loadKeys()}
        >
          <IconRefreshCw size={14} className={loading ? styles.spinning : ''} />
          <span>{t('header.refresh_all')}</span>
        </Button>
      </header>

      <main className={styles.content}>
        {loading ? (
          <Card className={styles.card}>
            <Skeleton height={200} />
          </Card>
        ) : (
          <Card className={styles.card}>
            <ApiKeysCardEditor
              value={keysText}
              disabled={saving}
              onChange={(next) => void handleKeysChange(next)}
            />
          </Card>
        )}
      </main>
    </div>
  );
}
