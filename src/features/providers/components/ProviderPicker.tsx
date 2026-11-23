import { useTranslation } from 'react-i18next';
import { IconChevronLeft, IconExternalLink } from '@/components/ui/icons';
import { getKimiAffiliateUrl } from '../kimi';
import { connectionCounts } from '../resourceView';
import type { ProviderBrand, ProviderGroup } from '../types';
import { BrandLogo } from './BrandLogo';
import styles from './ProviderPicker.module.scss';

interface ProviderPickerProps {
  groups: ProviderGroup[];
  /** `page` 在首次使用时将目录铺开。 */
  variant?: 'sheet' | 'page';
  onPick: (brand: ProviderBrand) => void;
}

export function ProviderPicker({ groups, variant = 'sheet', onPick }: ProviderPickerProps) {
  const { t, i18n } = useTranslation();
  const official = groups.filter((group) => group.id !== 'openaiCompatibility');
  const custom = groups.filter((group) => group.id === 'openaiCompatibility');

  const tile = (group: ProviderGroup) => {
    const brand = group.id;
    const count = connectionCounts(group).total;
    return (
      <li key={brand}>
        <button type="button" className={styles.tile} onClick={() => onPick(brand)}>
          <BrandLogo brand={brand} size={28} />
          <span className={styles.tileName}>{t(`providersPage.providerNames.${brand}`)}</span>
          {count > 0 ? (
            <span className={styles.connected}>{t('providersPage.picker.connected', { count })}</span>
          ) : null}
          <IconChevronLeft size={14} className={styles.tileChevron} aria-hidden="true" />
        </button>
        {brand === 'kimi' ? (
          <a
            className={styles.registerLink}
            href={getKimiAffiliateUrl(i18n.resolvedLanguage ?? i18n.language ?? '')}
            target="_blank"
            rel="noreferrer"
          >
            {t('providersPage.sponsor.registerNow')}
            <IconExternalLink size={12} aria-hidden="true" />
          </a>
        ) : null}
      </li>
    );
  };

  return (
    <div className={`${styles.picker} ${variant === 'page' ? styles.pickerPage : ''}`}>
      {official.length > 0 ? (
        <section className={styles.section}>
          <h3 className={styles.heading}>{t('providersPage.picker.official')}</h3>
          <ul className={styles.tiles}>{official.map(tile)}</ul>
        </section>
      ) : null}

      {custom.length > 0 ? (
        <section className={styles.section}>
          <h3 className={styles.heading}>{t('providersPage.picker.custom')}</h3>
          <ul className={styles.tiles}>{custom.map(tile)}</ul>
        </section>
      ) : null}
    </div>
  );
}
