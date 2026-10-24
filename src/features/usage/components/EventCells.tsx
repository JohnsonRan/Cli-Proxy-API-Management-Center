import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageEvent } from '@/services/api/usageStore';
import { formatCompact, formatMs, formatPercent } from '../format';
import type { UsageLabels } from '../hooks/useUsageLabels';
import { eventCacheHitRate, eventTransport, type EventDimension } from '../logic';
import { ProviderBadge } from './Labels';
import styles from '../UsagePage.module.scss';

/**
 * Dense two-line cells shared by the request events table and the realtime feed: the first
 * line carries the value that matters, the second the supporting details.
 */

type AddFilter = (dimension: EventDimension, value: string) => void;

/** Text that adds itself to the global filter when a handler is given, plain text otherwise. */
function FilterText({
  onClick,
  title,
  children,
}: {
  onClick?: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!onClick) return <>{children}</>;
  return (
    <button
      type="button"
      className={styles.filterTagBtn}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

export function EventStatusCell({
  event: e,
  onResult,
}: {
  event: UsageEvent;
  onResult?: (result: 'failed' | 'success') => void;
}) {
  const { t } = useTranslation();
  const transport = eventTransport(e.endpoint, e.stream, e.transport);
  return (
    <span className={styles.rankText}>
      <span className={styles.cellLine}>
        <FilterText
          onClick={onResult ? () => onResult(e.failed ? 'failed' : 'success') : undefined}
          title={t('usage_stats.filter_by_this', {
            name: e.failed ? t('usage_stats.result_failed') : t('usage_stats.result_success'),
          })}
        >
          <span className={e.failed ? styles.pillFailed : styles.pillOk}>
            {e.statusCode || (e.failed ? t('usage_stats.failed') : 'OK')}
          </span>
        </FilterText>
        <span
          className={`${styles.transportTag} ${styles[`transport_${transport}`]}`}
          title={t(`usage_stats.transport_${transport}_hint`)}
        >
          {t(`usage_stats.transport_${transport}`)}
        </span>
      </span>
      {e.endpoint && (
        <span className={styles.endpointSub} title={e.endpoint}>
          {e.endpoint}
        </span>
      )}
    </span>
  );
}

export function EventModelCell({ event: e, onAdd }: { event: UsageEvent; onAdd?: AddFilter }) {
  const { t } = useTranslation();
  const tier = e.serviceTier && !['default', 'auto'].includes(e.serviceTier) ? e.serviceTier : '';
  return (
    <span className={styles.rankText}>
      <span className={`${styles.cellStrong} ${styles.mono} ${styles.cellLine}`}>
        <FilterText
          onClick={onAdd ? () => onAdd('model', e.model) : undefined}
          title={t('usage_stats.filter_by_this', { name: e.model })}
        >
          {e.model}
        </FilterText>
        {e.substituted && e.responseModel && (
          <>
            <span className={styles.subArrow}>→</span>
            <span>{e.responseModel}</span>
            <span className={styles.substitutedBadge} title={t('usage_stats.substituted_hint')}>
              {t('usage_stats.substituted_tag')}
            </span>
          </>
        )}
      </span>
      <span className={`${styles.cellSub} ${styles.cellLine}`}>
        <FilterText
          onClick={onAdd ? () => onAdd('provider', e.provider) : undefined}
          title={t('usage_stats.filter_by_this', { name: e.provider })}
        >
          <ProviderBadge provider={e.provider} />
        </FilterText>
        {e.reasoningEffort && (
          <span className={styles.badge} title={t('usage_stats.reasoning_effort')}>
            {e.reasoningEffort}
          </span>
        )}
        {tier && (
          <span className={styles.tierBadge} title={t('usage_stats.service_tier')}>
            {tier}
          </span>
        )}
      </span>
    </span>
  );
}

export function EventRouteCell({
  event: e,
  labels,
  onAdd,
}: {
  event: Pick<UsageEvent, 'authIndex' | 'apiKeyId' | 'apiKey'> & { source?: string };
  labels: UsageLabels;
  onAdd?: AddFilter;
}) {
  const { t } = useTranslation();
  const credential = labels.credential(e.authIndex, e.source);
  const keyName = labels.keyName(e.apiKeyId);
  const masked = e.apiKey || t('usage_stats.none');
  return (
    <span className={styles.rankText}>
      <span className={styles.cellMain}>
        <FilterText
          onClick={onAdd && e.authIndex ? () => onAdd('auth_index', e.authIndex) : undefined}
          title={t('usage_stats.filter_by_this', { name: credential })}
        >
          {credential}
        </FilterText>
      </span>
      <span className={styles.cellSub}>
        <FilterText
          onClick={onAdd && e.apiKeyId ? () => onAdd('api_key_id', e.apiKeyId) : undefined}
          title={t('usage_stats.filter_by_this', { name: keyName || masked })}
        >
          {keyName ? (
            <>
              {keyName} <span className={styles.mono}>· {masked}</span>
            </>
          ) : (
            <span className={styles.mono}>{masked}</span>
          )}
        </FilterText>
      </span>
    </span>
  );
}

/** Input → output on top; cache read/write with hit rate and reasoning below. */
export function EventTokensCell({ event: e }: { event: UsageEvent }) {
  const { t } = useTranslation();
  const tk = e.tokens;
  const input = tk.inputUncached + tk.cacheRead + tk.cacheWrite + tk.unclassified;
  const hit = eventCacheHitRate(tk);
  return (
    <span className={styles.rankText}>
      <span className={styles.cellStrong}>
        {formatCompact(input)} → {formatCompact(tk.output)}
      </span>
      <span className={`${styles.cellSub} ${styles.tokenDetail}`}>
        <span title={t('usage_stats.cache_rw_hint')}>
          {t('usage_stats.tokens_cache_rw', {
            read: formatCompact(tk.cacheRead),
            write: formatCompact(tk.cacheWrite),
          })}
        </span>
        {hit !== null && (
          <span className={hit > 0 ? styles.cacheHit : undefined}>{formatPercent(hit, 0)}</span>
        )}
        {tk.reasoning > 0 && (
          <span className={styles.reasoningTokens}>
            {t('usage_stats.tokens_reasoning', { value: formatCompact(tk.reasoning) })}
          </span>
        )}
      </span>
    </span>
  );
}

export function EventLatencyCell({
  event: e,
  slowAfterMs = 0,
}: {
  event: UsageEvent;
  slowAfterMs?: number;
}) {
  return (
    <span className={styles.rankText}>
      <span
        className={
          slowAfterMs > 0 && e.latencyMs > slowAfterMs ? styles.slowValue : styles.cellStrong
        }
      >
        {formatMs(e.latencyMs)}
      </span>
      <span className={styles.cellSub}>TTFT {formatMs(e.ttftMs)}</span>
    </span>
  );
}
