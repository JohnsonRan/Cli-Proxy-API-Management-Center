import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { prefersReducedMotion } from '@/hooks/motion';
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

const DECISION_TONE: Record<string, string> = {
  scored: 'success',
  partial: 'warning',
  unscorable: 'error',
  not_model: 'error',
};

const STATE_TONE: Record<string, string> = {
  complete: 'stateOk',
  truncated: 'stateWarn',
  failed: 'stateError',
  cancelled: 'stateMuted',
};

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
  const resultRef = useRef<HTMLDivElement | null>(null);

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

  // On narrow screens the result stacks below the form; bring it into view once.
  useEffect(() => {
    if (!result) return;
    resultRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
    });
  }, [result]);

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
  const decisionTone = analysis ? (DECISION_TONE[analysis.decision] ?? 'muted') : 'muted';

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('fingerprint.title')}</h1>
        <p className={styles.pageDescription}>{t('fingerprint.description')}</p>
      </header>

      <div className={styles.layout}>
        <Card title={t('fingerprint.form_title')} className={styles.formCard}>
          <div className={styles.formFields}>
            <AutocompleteInput
              id="fingerprint-model"
              label={t('fingerprint.model')}
              value={model}
              onChange={setModel}
              options={modelOptions}
              placeholder={t('fingerprint.model_placeholder')}
              disabled={running}
            />
            <div className="form-group">
              <label htmlFor="fingerprint-api-format">{t('fingerprint.api_format')}</label>
              <Select
                id="fingerprint-api-format"
                value={apiFormat}
                options={formatOptions}
                onChange={(value) => setApiFormat(value as FingerprintApiFormat)}
                disabled={running}
                ariaLabel={t('fingerprint.api_format')}
                fullWidth
              />
            </div>
            <div className="form-group">
              <label htmlFor="fingerprint-api-key">{t('fingerprint.api_key')}</label>
              <Select
                id="fingerprint-api-key"
                value={apiKey}
                options={keyOptions}
                onChange={setApiKey}
                disabled={running}
                ariaLabel={t('fingerprint.api_key')}
                fullWidth
              />
            </div>
            <Input
              id="fingerprint-effort"
              label={t('fingerprint.effort')}
              value={effort}
              onChange={(event) => setEffort(event.target.value)}
              placeholder={t('fingerprint.effort_placeholder')}
              disabled={running}
            />
          </div>
          <div className={styles.footer}>
            <ToggleSwitch
              checked={stream}
              onChange={setStream}
              label={t('fingerprint.stream')}
              disabled={running}
            />
            <div className={styles.actions}>
              {running && (
                <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
                  {t('fingerprint.cancel')}
                </Button>
              )}
              <Button onClick={run} loading={running} disabled={!model.trim() || running}>
                {t('fingerprint.run')}
              </Button>
            </div>
          </div>
          <p className={styles.footnote}>{t('fingerprint.usage_hint')}</p>
        </Card>

        <div ref={resultRef} className={styles.resultColumn}>
          {error && <div className="error-box">{error}</div>}

          {!result && (
            <Card title={t('fingerprint.result_title')}>
              <div className={styles.placeholder} aria-live="polite">
                {running && <LoadingSpinner size={24} />}
                <p>{t(running ? 'fingerprint.running_hint' : 'fingerprint.empty_hint')}</p>
              </div>
            </Card>
          )}

          {result && (
            <Card
              title={t('fingerprint.result_title')}
              extra={
                analysis ? (
                  <span className={`status-badge ${decisionTone} ${styles.decisionBadge}`}>
                    {t(`fingerprint.decision_${analysis.decision}`, {
                      defaultValue: analysis.decision,
                    })}
                  </span>
                ) : null
              }
            >
              {result.error && <div className="error-box">{result.error}</div>}

              {analysis && (
                <div className={styles.verdict}>
                  <div className={styles.verdictMain}>
                    <div className={styles.label}>{t('fingerprint.prediction')}</div>
                    <div className={styles.verdictName}>{analysis.prediction_name || '—'}</div>
                    <div className={styles.verdictFamily}>
                      {t('fingerprint.family')} · {analysis.family_prediction_name || '—'}
                    </div>
                  </div>
                  <div className={styles.verdictScore}>
                    <div className={styles.label}>{t('fingerprint.probability')}</div>
                    <div className={styles.verdictPercent}>
                      {formatPercent(analysis.probability)}
                    </div>
                  </div>
                </div>
              )}

              {candidates.length > 0 && (
                <section className={styles.section}>
                  <h3 className={styles.sectionTitle}>{t('fingerprint.candidates_title')}</h3>
                  <Table>
                    <TableHeader>
                      <tr>
                        <TableHead>{t('fingerprint.candidate')}</TableHead>
                        <TableHead>{t('fingerprint.family')}</TableHead>
                        <TableHead alignRight>{t('fingerprint.score')}</TableHead>
                        <TableHead className={styles.probabilityHead}>
                          {t('fingerprint.probability')}
                        </TableHead>
                      </tr>
                    </TableHeader>
                    <TableBody>
                      {candidates.map((item, index) => (
                        <TableRow key={item.model} selected={index === 0}>
                          <TableCell className={styles.candidateName}>
                            {item.display_name || item.model}
                          </TableCell>
                          <TableCell className={styles.muted}>
                            {item.family_name || item.family}
                          </TableCell>
                          <TableCell alignRight className={styles.numeric}>
                            {item.score.toFixed(3)}
                          </TableCell>
                          <TableCell>
                            <div className={styles.probability}>
                              <span className={styles.bar} aria-hidden="true">
                                <span
                                  className={styles.barFill}
                                  style={{
                                    width: `${Math.min(100, Math.max(0, (item.probability ?? 0) * 100))}%`,
                                  }}
                                />
                              </span>
                              <span className={styles.numeric}>
                                {formatPercent(item.probability)}
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
              )}

              {result.samples.length > 0 && (
                <section className={styles.section}>
                  <h3 className={styles.sectionTitle}>{t('fingerprint.samples_title')}</h3>
                  <Table>
                    <TableHeader>
                      <tr>
                        <TableHead className={styles.indexCol}>#</TableHead>
                        <TableHead>{t('fingerprint.sample_state')}</TableHead>
                        <TableHead alignRight>{t('fingerprint.sample_numbers')}</TableHead>
                        <TableHead>{t('fingerprint.response_model')}</TableHead>
                      </tr>
                    </TableHeader>
                    <TableBody>
                      {result.samples.map((sample, index) => (
                        <TableRow key={index}>
                          <TableCell className={styles.muted}>{index + 1}</TableCell>
                          <TableCell>
                            <span className={styles[STATE_TONE[sample.state] ?? 'stateMuted']}>
                              {t(`fingerprint.state_${sample.state}`, {
                                defaultValue: sample.state,
                              })}
                            </span>
                            {sample.error && (
                              <div className={styles.sampleError}>{sample.error}</div>
                            )}
                          </TableCell>
                          <TableCell alignRight className={styles.numeric}>
                            {sample.count} / {sample.expected_count}
                          </TableCell>
                          <TableCell className={styles.mono}>
                            {sample.response_model || '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
              )}

              <p className={styles.footnote}>
                {t('fingerprint.disclaimer', { builtAt: result.built_at || '—' })}
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
