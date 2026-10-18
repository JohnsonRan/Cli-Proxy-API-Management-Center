import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { authFilesApi } from '@/services/api/authFiles';
import { useConfigStore } from '@/stores';
import type { AuthFileItem } from '@/types/authFile';
import {
  buildQuotaCredentialOptions,
  buildQuotaRelayOptions,
  loadQuotaCredentialsSources,
} from '@/utils/quotaCredentials';
import styles from './ApiKeysPage.module.scss';

interface ClientKeyQuotaCredentialsFieldProps {
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}

export function ClientKeyQuotaCredentialsField({
  value,
  onChange,
  disabled,
}: ClientKeyQuotaCredentialsFieldProps) {
  const { t } = useTranslation();
  const labelId = useId();
  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const config = useConfigStore((store) => store.config);
  const fetchConfig = useConfigStore((store) => store.fetchConfig);

  const load = useCallback(async () => {
    setState('loading');
    const result = await loadQuotaCredentialsSources(
      () => authFilesApi.list(),
      () => fetchConfig()
    );
    if (result.state === 'ready') {
      setFiles(result.files);
      setState('ready');
    } else {
      setState('error');
    }
  }, [fetchConfig]);

  useEffect(() => {
    void load();
  }, [load]);

  // Until the list arrives every saved ID would look removed, so list nothing before then.
  const options = useMemo(
    () =>
      state === 'ready'
        ? buildQuotaCredentialOptions(files, value, buildQuotaRelayOptions(config))
        : [],
    [config, files, state, value]
  );
  const selected = useMemo(() => new Set(value), [value]);

  const toggle = (id: string, checked: boolean) => {
    onChange(checked ? [...value, id] : value.filter((item) => item !== id));
  };

  return (
    <div className="form-group" role="group" aria-labelledby={labelId}>
      <label id={labelId}>{t('api_keys_page.quota_credentials.label')}</label>
      {state === 'error' && (
        <div className={styles.quotaCredentialStatus}>
          <span>{t('api_keys_page.quota_credentials.load_failed')}</span>
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={disabled}>
            {t('api_keys_page.quota_credentials.retry')}
          </Button>
        </div>
      )}
      {state === 'loading' && options.length === 0 && (
        <div className="hint">{t('api_keys_page.quota_credentials.loading')}</div>
      )}
      {state === 'ready' && options.length === 0 && (
        <div className="hint">{t('api_keys_page.quota_credentials.empty')}</div>
      )}
      {options.length > 0 && (
        <div className={styles.quotaCredentialList}>
          {options.map((option) => (
            <SelectionCheckbox
              key={option.id}
              checked={selected.has(option.id)}
              onChange={(checked) => toggle(option.id, checked)}
              disabled={disabled}
              title={option.id}
              label={
                <span className={styles.quotaCredentialLabel}>
                  {option.provider && (
                    <span className={styles.quotaCredentialProvider}>{option.provider}</span>
                  )}
                  <span>{option.label}</span>
                  {option.missing && (
                    <span className={styles.quotaCredentialMissing}>
                      {t('api_keys_page.quota_credentials.missing')}
                    </span>
                  )}
                  {option.disabled && (
                    <span className={styles.quotaCredentialMissing}>
                      {t('api_keys_page.quota_credentials.disabled')}
                    </span>
                  )}
                  {option.ownKey && (
                    <span className={styles.quotaCredentialMissing}>
                      {t('api_keys_page.quota_credentials.own_key')}
                    </span>
                  )}
                </span>
              }
            />
          ))}
        </div>
      )}
      <div className="hint">{t('api_keys_page.quota_credentials.hint')}</div>
    </div>
  );
}
