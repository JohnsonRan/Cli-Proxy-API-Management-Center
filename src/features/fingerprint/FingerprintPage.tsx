import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { useApiKeysForModels } from '@/hooks/useApiKeysForModels';
import { useAuthStore, useModelsStore } from '@/stores';
import {
  fingerprintApi,
  type FingerprintApiFormat,
  type FingerprintDetectResult,
} from '@/services/api/fingerprint';
import { maskApiKey } from '@/utils/format';
import { getErrorMessage } from '@/utils/helpers';
import styles from './FingerprintPage.module.scss';

const API_FORMATS: FingerprintApiFormat[] = ['responses', 'chat_completions', 'messages'];
const TOP_CANDIDATES = 5;

const formatPercent = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';

export function FingerprintPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const models = useModelsStore((state) => state.models);
  const fetchModels = useModelsStore((state) => state.fetchModels);
  const resolveApiKeys = useApiKeysForModels();

  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiFormat, setApiFormat] = useState<FingerprintApiFormat>('responses');
  const [effort, setEffort] = useState('');
  const [stream, setStream] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<FingerprintDetectResult | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (connectionStatus !== 'connected' || !apiBase) return;
    let cancelled = false;
    void (async () => {
      const keys = await resolveApiKeys();
      if (cancelled) return;
      setApiKeys(keys);
      try {
        await fetchModels(apiBase, keys[0]);
      } catch {
        // The model field still accepts a typed name.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionStatus, apiBase, resolveApiKeys, fetchModels]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const modelOptions = useMemo(() => models.map((item) => item.name), [models]);
  const keyOptions = useMemo(
    () => [
      { value: '', label: t('fingerprint.api_key_default') },
      ...apiKeys.map((key) => ({ value: key, label: maskApiKey(key) })),
    ],
    [apiKeys, t]
  );
  const formatOptions = useMemo(
    () => API_FORMATS.map((value) => ({ value, label: t(`fingerprint.api_${value}`) })),
    [t]
  );

  const run = async () => {
    const name = model.trim();
    if (!name || running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const data = await fingerprintApi.detect(
        {
          model: name,
          api: apiFormat,
          api_key: apiKey || undefined,
          effort: effort.trim() || undefined,
          no_stream: !stream,
        },
        controller.signal
      );
      setResult(data);
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        setError(getErrorMessage(err, t('fingerprint.failed')));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(false);
    }
  };

  const analysis = result?.analysis ?? null;
  const candidates = analysis?.results.slice(0, TOP_CANDIDATES) ?? [];

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('fingerprint.title')}</h1>
      <div className={styles.content}>
        <Card title={t('fingerprint.form_title')}>
          <p className="hint">{t('fingerprint.description')}</p>
          <div className={styles.formGrid}>
            <AutocompleteInput
              label={t('fingerprint.model')}
              value={model}
              onChange={setModel}
              options={modelOptions}
              placeholder={t('fingerprint.model_placeholder')}
              disabled={running}
            />
            <div className="form-group">
              <label>{t('fingerprint.api_format')}</label>
              <Select
                value={apiFormat}
                options={formatOptions}
                onChange={(value) => setApiFormat(value as FingerprintApiFormat)}
                disabled={running}
                ariaLabel={t('fingerprint.api_format')}
                fullWidth
              />
            </div>
            <div className="form-group">
              <label>{t('fingerprint.api_key')}</label>
              <Select
                value={apiKey}
                options={keyOptions}
                onChange={setApiKey}
                disabled={running}
                ariaLabel={t('fingerprint.api_key')}
                fullWidth
              />
            </div>
            <Input
              label={t('fingerprint.effort')}
              value={effort}
              onChange={(event) => setEffort(event.target.value)}
              placeholder={t('fingerprint.effort_placeholder')}
              disabled={running}
            />
          </div>
          <div className={styles.actions}>
            <ToggleSwitch
              checked={stream}
              onChange={setStream}
              label={t('fingerprint.stream')}
              disabled={running}
            />
            {running && (
              <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
                {t('fingerprint.cancel')}
              </Button>
            )}
            <Button onClick={run} loading={running} disabled={!model.trim() || running}>
              {t('fingerprint.run')}
            </Button>
          </div>
          <p className="hint">{t('fingerprint.usage_hint')}</p>
        </Card>

        {error && <div className="error-box">{error}</div>}

        {result && (
          <Card title={t('fingerprint.result_title')}>
            {result.error ? (
              <div className="error-box">{result.error}</div>
            ) : analysis ? (
              <div className={styles.summary}>
                <div>
                  <div className={styles.label}>{t('fingerprint.prediction')}</div>
                  <div className={styles.value}>{analysis.prediction_name || '—'}</div>
                </div>
                <div>
                  <div className={styles.label}>{t('fingerprint.family')}</div>
                  <div className={styles.value}>{analysis.family_prediction_name || '—'}</div>
                </div>
                <div>
                  <div className={styles.label}>{t('fingerprint.probability')}</div>
                  <div className={styles.value}>{formatPercent(analysis.probability)}</div>
                </div>
                <div>
                  <div className={styles.label}>{t('fingerprint.decision')}</div>
                  <div className={styles.value}>
                    {t(`fingerprint.decision_${analysis.decision}`, {
                      defaultValue: analysis.decision,
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            {candidates.length > 0 && (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t('fingerprint.candidate')}</th>
                    <th>{t('fingerprint.family')}</th>
                    <th>{t('fingerprint.score')}</th>
                    <th>{t('fingerprint.probability')}</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((item) => (
                    <tr key={item.model}>
                      <td>{item.display_name || item.model}</td>
                      <td>{item.family_name || item.family}</td>
                      <td>{item.score.toFixed(3)}</td>
                      <td>{formatPercent(item.probability)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('fingerprint.sample_state')}</th>
                  <th>{t('fingerprint.sample_numbers')}</th>
                  <th>{t('fingerprint.response_model')}</th>
                </tr>
              </thead>
              <tbody>
                {result.samples.map((sample, index) => (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td>
                      {sample.state}
                      {sample.error && <div className={styles.sampleError}>{sample.error}</div>}
                    </td>
                    <td>
                      {sample.count} / {sample.expected_count}
                    </td>
                    <td>{sample.response_model || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">
              {t('fingerprint.disclaimer', { builtAt: result.built_at || '—' })}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
