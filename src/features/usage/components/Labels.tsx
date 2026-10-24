import { useTranslation } from 'react-i18next';
import iconOpenAIDark from '@/assets/icons/openai-dark.svg';
import iconOpenAILight from '@/assets/icons/openai-light.svg';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { useThemeStore } from '@/stores';
import { providerDisplay } from '../logic';
import styles from '../UsagePage.module.scss';

/** Provider icon and name, labelled the same way as the auth-file and provider pages. */
export function ProviderBadge({ provider }: { provider: string }) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const display = providerDisplay(provider);
  const icon = display.compat
    ? resolvedTheme === 'dark'
      ? iconOpenAIDark
      : iconOpenAILight
    : getAuthFileIcon(display.type, resolvedTheme);
  return (
    <span className={styles.providerBadge} title={provider}>
      {icon && <img src={icon} alt="" className={styles.providerIcon} />}
      <span>{display.compat ? display.name : getTypeLabel(t, display.type)}</span>
      {display.compat && <span className={styles.compatTag}>{t('usage_stats.compat_tag')}</span>}
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
