import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageEvent } from '@/services/api/usageStore';
import { formatCompact, formatCost, formatMs, formatPercent, formatTps } from '../format';
import { Compact } from './PanelBits';
import type { UsageLabels } from '../hooks/useUsageLabels';
import {
  eventCacheHitRate,
  eventCostPerMillion,
  eventErrorSummary,
  eventTransport,
  formatClientGeoLine,
  riskHint,
  riskLabel,
  type EventDimension,
  type UsageEventGroup,
} from '../logic';
import { ProviderBadge } from './Labels';
import styles from '../UsagePage.module.scss';

/**
 * Dense two-line cells shared by the request events table and the realtime feed: the first
 * line carries the value that matters, the second the supporting details.
 */

type AddFilter = (dimension: EventDimension, value: string) => void;

/** Upstream safety action on a request (cyber_policy, model_reroute, ...). */
export function RiskBadge({ risk, reason }: { risk: string; reason?: string }) {
  const { t } = useTranslation();
  return (
    <span className={styles.riskBadge} title={reason || riskHint(t, risk)}>
      {riskLabel(t, risk)}
    </span>
  );
}

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
  const errorLine = e.failed ? eventErrorSummary(e.error) : '';
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
      {errorLine && (
        <span className={styles.errorSub} title={e.error}>
          {errorLine}
        </span>
      )}
    </span>
  );
}

/**
 * Status of a WebSocket connection folded into one row: the newest turn's status, or the in-flight
 * pill while the connection is open, then the turn count, which toggles the turn rows.
 */
export function EventGroupStatusCell({
  group,
  live,
  expanded,
}: {
  group: UsageEventGroup;
  live: boolean;
  expanded: boolean;
}) {
  const { t } = useTranslation();
  const e = group.summary;
  return (
    <span className={styles.rankText}>
      <span className={styles.cellLine}>
        {live ? (
          <span className={styles.pillPending} title={t('usage_stats.ws_group_live_hint')}>
            {t('usage_stats.realtime_in_flight')}
          </span>
        ) : (
          <span className={e.failed ? styles.pillFailed : styles.pillOk}>
            {e.statusCode || (e.failed ? t('usage_stats.failed') : 'OK')}
          </span>
        )}
        <span
          className={`${styles.transportTag} ${styles.transport_ws}`}
          title={t('usage_stats.transport_ws_hint')}
        >
          {t('usage_stats.transport_ws')}
        </span>
        <span
          className={`${styles.groupCount} ${expanded ? styles.groupCountOpen : ''}`}
          title={t('usage_stats.ws_group_hint', { count: group.events.length })}
        >
          ×{group.events.length}
        </span>
      </span>
      {e.endpoint && (
        <span className={styles.endpointSub} title={e.endpoint}>
          {e.endpoint}
        </span>
      )}
      {group.failed > 0 && (
        <span className={styles.errorSub}>
          {t('usage_stats.ws_group_failed', { count: group.failed })}
        </span>
      )}
    </span>
  );
}

/** Time on top, date below, so the column stays narrow. */
export function EventTimeCell({
  timestamp,
  timeFormatter,
  dateFormatter,
}: {
  timestamp: number;
  timeFormatter: Intl.DateTimeFormat;
  dateFormatter: Intl.DateTimeFormat;
}) {
  const date = new Date(timestamp);
  return (
    <span className={`${styles.rankText} ${styles.mono}`}>
      <span className={styles.cellStrong}>{timeFormatter.format(date)}</span>
      <span className={styles.cellSub}>{dateFormatter.format(date)}</span>
    </span>
  );
}

/** Cost on top; the event's blended price per million tokens below. */
export function EventCostCell({ event: e }: { event: UsageEvent }) {
  const { t } = useTranslation();
  if (!e.priced) return <span className={styles.muted}>{t('usage_stats.unpriced')}</span>;
  const perMillion = eventCostPerMillion(e);
  return (
    <span className={styles.rankText}>
      <span className={styles.cellStrong}>{formatCost(e.cost)}</span>
      {perMillion !== null && (
        <span className={styles.cellSub} title={t('usage_stats.col_cost_per_m')}>
          {formatCost(perMillion)}/M
        </span>
      )}
    </span>
  );
}

export function EventModelCell({ event: e, onAdd }: { event: UsageEvent; onAdd?: AddFilter }) {
  const { t } = useTranslation();
  const tier = e.serviceTier && !['default', 'auto'].includes(e.serviceTier) ? e.serviceTier : '';
  const hasBadges = e.substituted || Boolean(e.risk);
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
      {hasBadges && (
        <span className={`${styles.cellSub} ${styles.cellLine}`}>
          {e.substituted && (
            <span className={styles.substitutedBadge} title={t('usage_stats.substituted_hint')}>
              {t('usage_stats.substituted_tag')}
            </span>
          )}
          {e.risk && <RiskBadge risk={e.risk} reason={e.riskReason} />}
        </span>
      )}
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
  // A model that has never served a cache read has no meaningful hit rate.
  const hit = e.cacheable === false ? null : eventCacheHitRate(tk);
  return (
    <span className={styles.rankText}>
      <span className={styles.cellStrong}>
        <Compact value={input} /> → <Compact value={tk.output} />
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
      <span className={styles.cellSub}>
        TTFT {formatMs(e.ttftMs)}
        {e.outputTps > 0 && ` · ${formatTps(e.outputTps)}`}
      </span>
    </span>
  );
}

export function EventClientCell({ event: e }: { event: UsageEvent }) {
  const { t, i18n } = useTranslation();
  const geoLine = formatClientGeoLine(e.clientGeo, i18n.language, t);
  return (
    <div className={styles.clientCell}>
      <span className={`${styles.mono} ${styles.clientText}`} title={e.clientIp || undefined}>
        {e.clientIp || '—'}
      </span>
      {geoLine && (
        <span className={styles.clientSub} title={geoLine}>
          {geoLine}
        </span>
      )}
      {e.userAgent && (
        <span className={styles.clientSub} title={e.userAgent}>
          {e.userAgent}
        </span>
      )}
    </div>
  );
}
