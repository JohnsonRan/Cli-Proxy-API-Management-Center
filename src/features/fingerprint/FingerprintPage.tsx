import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
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

type Tone = 'Good' | 'Warn' | 'Bad' | 'Muted';

const DECISION_TONE: Record<string, Tone> = {
  scored: 'Good',
  partial: 'Warn',
  unscorable: 'Bad',
  not_model: 'Bad',
};

const STATE_TONE: Record<string, Tone> = {
  complete: 'Good',
  truncated: 'Warn',
  failed: 'Bad',
  cancelled: 'Muted',
};

interface RunInfo {
  model: string;
  api: FingerprintApiFormat;
}

/** Headline figure in the usage page's stat card style: dot, label, value and caption. */
function StatCard({
  label,
  value,
  sub,
  dot,
  loading,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  dot: Tone | 'Primary';
  loading: boolean;
}) {
  return (
    <Card className={styles.statCard}>
      <span className={styles.statLabelGroup}>
        <span className={`${styles.metricDot} ${styles[`dot${dot}`]}`} aria-hidden="true" />
        <span className={styles.statLabel}>{label}</span>
      </span>
      {loading ? (
        <Skeleton height={32} width="60%" rounded={6} />
      ) : (
        <span className={styles.statValue}>{value}</span>
      )}
      <span className={styles.statSub}>{loading ? '' : sub}</span>
    </Card>
  );
}

function PanelHeading({ title, desc }: { title: string; desc: string }) {
  return (
    <div className={styles.panelHeading}>
      <h2 className={styles.panelTitle}>{title}</h2>
      <p className={styles.panelDesc}>{desc}</p>
    </div>
  );
}

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
  const [runInfo, setRunInfo] = useState<RunInfo | null>(null);
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
    setRunInfo({ model: name, api: apiFormat });
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
  const samples = result?.samples ?? [];
  const completeSamples = samples.filter((sample) => sample.state === 'complete').length;
  const numberCount = samples.reduce((sum, sample) => sum + sample.count, 0);
  const numberExpected = samples.reduce((sum, sample) => sum + sample.expected_count, 0);
  const emptyText = t(running ? 'fingerprint.running_hint' : 'fingerprint.empty_hint');
  const decisionTone: Tone = analysis ? (DECISION_TONE[analysis.decision] ?? 'Muted') : 'Muted';

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('fingerprint.title')}</h1>
        <p className={styles.meta}>
          {result && runInfo
            ? t('fingerprint.meta', {
                model: runInfo.model,
                api: t(`fingerprint.api_${runInfo.api}`),
              })
            : t('fingerprint.subtitle')}
        </p>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.controls}>
          <div className={styles.modelControl}>
            <AutocompleteInput
              id="fingerprint-model"
              label={t('fingerprint.model')}
              value={model}
              onChange={setModel}
              options={modelOptions}
              placeholder={t('fingerprint.model_placeholder')}
              disabled={running}
            />
          </div>
          <div className={`form-group ${styles.selectControl}`}>
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
          <div className={`form-group ${styles.selectControl}`}>
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
          <div className={styles.effortControl}>
            <Input
              id="fingerprint-effort"
              label={t('fingerprint.effort')}
              value={effort}
              onChange={(event) => setEffort(event.target.value)}
              placeholder={t('fingerprint.effort_placeholder')}
              disabled={running}
            />
          </div>
          <div className={styles.runControls}>
            <ToggleSwitch
              checked={stream}
              onChange={setStream}
              label={t('fingerprint.stream')}
              disabled={running}
            />
            {running ? (
              <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
                {t('fingerprint.cancel')}
              </Button>
            ) : (
              <Button onClick={run} disabled={!model.trim()}>
                {t('fingerprint.run')}
              </Button>
            )}
          </div>
        </div>
        <p className={styles.toolbarNote}>
          {t('fingerprint.description')} {t('fingerprint.usage_hint')}
        </p>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}
      {result?.error && (
        <div className={styles.errorBanner} role="alert">
          {result.error}
        </div>
      )}

      <div className={styles.cards} aria-busy={running}>
        <StatCard
          label={t('fingerprint.prediction')}
          value={analysis?.prediction_name || '—'}
          sub={analysis?.family_prediction_name}
          dot="Primary"
          loading={running}
        />
        <StatCard
          label={t('fingerprint.probability')}
          value={formatPercent(analysis?.probability)}
          sub={analysis ? t('fingerprint.probability_sub') : undefined}
          dot="Good"
          loading={running}
        />
        <StatCard
          label={t('fingerprint.decision')}
          value={
            analysis ? (
              <span className={styles[`tone${decisionTone}`]}>
                {t(`fingerprint.decision_${analysis.decision}`, {
                  defaultValue: analysis.decision,
                })}
              </span>
            ) : (
              '—'
            )
          }
          sub={analysis ? t('fingerprint.used_outputs', { n: analysis.used_outputs }) : undefined}
          dot={decisionTone}
          loading={running}
        />
        <StatCard
          label={t('fingerprint.valid_samples')}
          value={samples.length ? `${completeSamples} / ${samples.length}` : '—'}
          sub={
            samples.length
              ? t('fingerprint.valid_numbers', { n: numberCount, expected: numberExpected })
              : undefined
          }
          dot="Muted"
          loading={running}
        />
      </div>

      <div className={styles.split}>
        <section className={styles.panel}>
          <PanelHeading
            title={t('fingerprint.candidates_title')}
            desc={t('fingerprint.candidates_desc', { n: TOP_CANDIDATES })}
          />
          {candidates.length > 0 ? (
            <Table>
              <TableHeader>
                <tr>
                  <TableHead>{t('fingerprint.candidate')}</TableHead>
                  <TableHead alignRight>{t('fingerprint.score')}</TableHead>
                  <TableHead alignRight>{t('fingerprint.probability')}</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {candidates.map((item, index) => (
                  <TableRow key={item.model}>
                    <TableCell>
                      <span className={styles.rankName}>
                        <span className={styles.rank}>{index + 1}</span>
                        <span className={styles.rankText}>
                          <span className={styles.cellStrong}>
                            {item.display_name || item.model}
                          </span>
                          <span className={styles.cellSub}>{item.family_name || item.family}</span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell alignRight className={styles.numeric}>
                      {item.score.toFixed(3)}
                    </TableCell>
                    <TableCell alignRight>
                      <span className={styles.share}>
                        <span className={styles.shareText}>{formatPercent(item.probability)}</span>
                        <span className={styles.shareTrack} aria-hidden="true">
                          <span
                            className={styles.shareBar}
                            style={{
                              width: `${Math.min(100, Math.max(0, (item.probability ?? 0) * 100))}%`,
                            }}
                          />
                        </span>
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className={styles.empty}>{emptyText}</p>
          )}
        </section>

        <section className={styles.panel}>
          <PanelHeading
            title={t('fingerprint.samples_title')}
            desc={t('fingerprint.samples_desc')}
          />
          {samples.length > 0 ? (
            <Table>
              <TableHeader>
                <tr>
                  <TableHead>#</TableHead>
                  <TableHead>{t('fingerprint.sample_state')}</TableHead>
                  <TableHead alignRight>{t('fingerprint.sample_numbers')}</TableHead>
                  <TableHead>{t('fingerprint.response_model')}</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {samples.map((sample, index) => (
                  <TableRow key={index}>
                    <TableCell className={styles.rank}>{index + 1}</TableCell>
                    <TableCell>
                      <span className={styles[`tone${STATE_TONE[sample.state] ?? 'Muted'}`]}>
                        {t(`fingerprint.state_${sample.state}`, { defaultValue: sample.state })}
                      </span>
                      {sample.error && <span className={styles.errorText}>{sample.error}</span>}
                    </TableCell>
                    <TableCell alignRight className={styles.numeric}>
                      {sample.count} / {sample.expected_count}
                    </TableCell>
                    <TableCell className={styles.mono}>{sample.response_model || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className={styles.empty}>{emptyText}</p>
          )}
        </section>
      </div>

      {result && (
        <p className={styles.footnote}>
          {t('fingerprint.disclaimer', { builtAt: result.built_at || '—' })}
        </p>
      )}
    </div>
  );
}
