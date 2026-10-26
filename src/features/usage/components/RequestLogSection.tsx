import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { logsApi, responseDataToText } from '@/services/api/logs';
import { Button } from '@/components/ui/Button';
import { downloadBlob } from '@/utils/download';
import styles from '../UsagePage.module.scss';

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

type LogState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'error'; message: string };

const statusOf = (err: unknown): number | undefined =>
  typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number'
    ? err.status
    : undefined;

/**
 * Loads the stored request log of one request on demand. Logs exist when request logging is
 * on, or for failed requests while error logs are kept; otherwise the core answers 404.
 */
export function RequestLogSection({ requestId }: { requestId: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<LogState>({ status: 'idle' });
  const requestRef = useRef(0);

  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    []
  );

  if (!requestId) return null;

  const errorMessage = (err: unknown) =>
    statusOf(err) === 404
      ? t('usage_stats.request_log_missing')
      : err instanceof Error && err.message
        ? err.message
        : t('usage_stats.request_log_failed');

  const view = async () => {
    const id = ++requestRef.current;
    setState({ status: 'loading' });
    try {
      const response = await logsApi.downloadRequestLogById(requestId);
      if (response.data instanceof Blob && response.data.size > MAX_PREVIEW_BYTES) {
        throw new Error(t('usage_stats.request_log_too_large'));
      }
      const text = await responseDataToText(response.data);
      if (id === requestRef.current) setState({ status: 'ready', text });
    } catch (err: unknown) {
      if (id === requestRef.current) setState({ status: 'error', message: errorMessage(err) });
    }
  };

  const download = async () => {
    try {
      const response = await logsApi.downloadRequestLogById(requestId);
      const blob =
        response.data instanceof Blob ? response.data : new Blob([String(response.data)]);
      downloadBlob({ filename: `request-${requestId}.log`, blob });
    } catch (err: unknown) {
      setState({ status: 'error', message: errorMessage(err) });
    }
  };

  return (
    <div>
      <div className={styles.logActions}>
        <Button
          variant="secondary"
          size="sm"
          loading={state.status === 'loading'}
          onClick={() => void view()}
        >
          {t('usage_stats.request_log_view')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void download()}>
          {t('usage_stats.request_log_download')}
        </Button>
      </div>
      {state.status === 'error' && (
        <p className={styles.errorText} role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'ready' && (
        <pre className={styles.logViewer} aria-label={t('usage_stats.request_log_view')}>
          {state.text}
        </pre>
      )}
    </div>
  );
}
