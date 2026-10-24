import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageEvent } from '@/services/api/usageStore';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useNotificationStore } from '@/stores';
import { formatCompact, formatCost, formatMs, formatTps } from '../format';
import type { UsageLabels } from '../hooks/useUsageLabels';
import { ProviderBadge } from './Labels';
import { RequestLogSection } from './RequestLogSection';
import { eventTransport } from '../logic';
import styles from '../UsagePage.module.scss';

export function EventDetailModal({
  event,
  labels,
  onClose,
}: {
  event: UsageEvent | null;
  labels: UsageLabels;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  if (!event) return null;

  const copy = (text: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => showNotification(t('usage_stats.copied'), 'success'))
      .catch(() => showNotification(t('usage_stats.copy_failed'), 'error'));
  };

  const tk = event.tokens;
  const keyName = labels.keyName(event.apiKeyId);
  const rows: [string, ReactNode][] = [
    [t('usage_stats.col_time'), new Date(event.timestamp).toLocaleString(i18n.language)],
    [t('usage_stats.detail_request_id'), event.requestId || '—'],
    [
      t('usage_stats.col_status'),
      String(event.statusCode || (event.failed ? t('usage_stats.failed') : 'OK')),
    ],
    [t('usage_stats.detail_endpoint'), event.endpoint || '—'],
    [
      t('usage_stats.col_model'),
      event.alias && event.alias !== event.model ? `${event.alias} → ${event.model}` : event.model,
    ],
    ...(event.responseModel
      ? [
          [
            t('usage_stats.detail_served_model'),
            <span key="served" className={styles.mono}>
              {event.responseModel}
              {event.substituted && (
                <span className={styles.substitutedBadge} title={t('usage_stats.substituted_hint')}>
                  {t('usage_stats.substituted_tag')}
                </span>
              )}
            </span>,
          ] as [string, ReactNode],
        ]
      : []),
    [t('usage_stats.col_provider'), <ProviderBadge provider={event.provider} />],
    [t('usage_stats.col_credential'), labels.credential(event.authIndex, event.source)],
    [
      t('usage_stats.col_key'),
      keyName ? `${keyName} · ${event.apiKey}` : event.apiKey || t('usage_stats.none'),
    ],
    [
      t('usage_stats.detail_tier'),
      [event.serviceTier, event.reasoningEffort].filter(Boolean).join(' · ') || '—',
    ],
    [
      t('usage_stats.detail_transport'),
      t(
        `usage_stats.transport_${eventTransport(event.endpoint, event.stream, event.transport)}_hint`
      ),
    ],
    [t('usage_stats.col_latency'), `${formatMs(event.latencyMs)} · TTFT ${formatMs(event.ttftMs)}`],
    [t('usage_stats.col_speed'), formatTps(event.outputTps)],
    [
      t('usage_stats.col_tokens'),
      t('usage_stats.detail_tokens', {
        input: formatCompact(tk.inputUncached + tk.unclassified),
        cached: formatCompact(tk.cacheRead),
        written: formatCompact(tk.cacheWrite),
        output: formatCompact(tk.output),
        reasoning: formatCompact(tk.reasoning),
        total: formatCompact(tk.total),
      }),
    ],
    [t('usage_stats.col_cost'), event.priced ? formatCost(event.cost) : t('usage_stats.unpriced')],
    [
      t('usage_stats.detail_client'),
      [event.clientIp, event.userAgent].filter(Boolean).join(' · ') || '—',
    ],
  ];

  return (
    <Modal
      open
      closeOnBackdrop
      title={t('usage_stats.detail_title')}
      onClose={onClose}
      width={640}
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => copy(JSON.stringify(event, null, 2))}
          >
            {t('usage_stats.copy_json')}
          </Button>
          <Button size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      <dl className={styles.detailList}>
        {rows.map(([label, value]) => (
          <div key={label} className={styles.detailRow}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {event.error && (
        <div className={styles.detailError}>
          <div className={styles.panelHeader}>
            <span className={styles.statLabel}>{t('usage_stats.detail_error')}</span>
            <Button variant="ghost" size="sm" onClick={() => copy(event.error)}>
              {t('usage_stats.copy')}
            </Button>
          </div>
          <pre>{event.error}</pre>
        </div>
      )}
      <RequestLogSection key={event.id} requestId={event.requestId} />
    </Modal>
  );
}
