import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getTypeLabel } from '@/features/authFiles/constants';
import { useConfigStore, useThemeStore } from '@/stores';
import { resolveProviderBadgeIcon } from '../icons';
import { providerDisplay } from '../logic';
import styles from '../UsagePage.module.scss';

/** Provider icon and name, labelled the same way as the auth-file and provider pages. */
export function ProviderBadge({
  provider,
  model,
  fallbackModel,
}: {
  provider: string;
  model?: string;
  fallbackModel?: string;
}) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const openaiCompatibility = useConfigStore((state) => state.config?.openaiCompatibility);
  const display = providerDisplay(provider);

  const compatBaseUrl = useMemo(() => {
    if (!display.compat || !openaiCompatibility?.length) return undefined;
    const targetName = (display.name ?? '').trim().toLowerCase();
    return openaiCompatibility.find(
      (entry) => (entry.name ?? '').trim().toLowerCase() === targetName
    )?.baseUrl;
  }, [display.compat, display.name, openaiCompatibility]);

  const { src: primaryIcon, fallbackSrc } = resolveProviderBadgeIcon({
    provider,
    model,
    fallbackModel,
    resolvedTheme,
    compatBaseUrl,
  });
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const icon = primaryIcon && failedSrc === primaryIcon && fallbackSrc ? fallbackSrc : primaryIcon;

  return (
    <span className={styles.providerBadge} title={provider}>
      {icon && (
        <img
          src={icon}
          alt=""
          className={styles.providerIcon}
          onError={
            primaryIcon && fallbackSrc && icon === primaryIcon
              ? () => setFailedSrc(primaryIcon)
              : undefined
          }
        />
      )}
      {display.compat ? (
        display.name ? (
          <>
            <span>{display.name}</span>
            <span className={styles.compatTag}>{t('usage_stats.compat_tag')}</span>
          </>
        ) : (
          <span>{t('usage_stats.compat_tag')}</span>
        )
      ) : (
        <span>{getTypeLabel(t, display.type)}</span>
      )}
    </span>
  );
}

/** Client key shown by its note name with the masked key below, or the masked key alone. */
export function KeyLabel({ name, masked }: { name: string | null; masked: string }) {
  const { t } = useTranslation();
  const maskedText = masked || t('usage_stats.none');
  if (!name) return <span className={`${styles.cellStrong} ${styles.mono}`}>{maskedText}</span>;
  return (
    <span className={styles.rankText}>
      <span className={styles.cellStrong}>{name}</span>
      <span className={`${styles.cellSub} ${styles.mono}`}>{maskedText}</span>
    </span>
  );
}
