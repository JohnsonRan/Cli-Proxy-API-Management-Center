import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { IconChevronDown, IconSearch, IconX } from '@/components/ui/icons';
import { filterMultiSelectOptions, mergeSelectedOptions, type MultiSelectOption } from '../logic';
import styles from '../UsagePage.module.scss';

export interface MultiSelectFilterProps {
  label: string;
  selected: string[];
  options: MultiSelectOption[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
}

export function MultiSelectFilter({
  label,
  selected,
  options,
  onChange,
  disabled = false,
}: MultiSelectFilterProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Close popover on outside click.
  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isOpen]);

  // Focus search input when popover opens.
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      const timer = window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  }, []);

  const merged = useMemo(() => mergeSelectedOptions(options, selected), [options, selected]);
  const filtered = useMemo(() => filterMultiSelectOptions(merged, search), [merged, search]);

  const handleToggle = useCallback(
    (value: string, checked: boolean) => {
      if (checked) {
        if (!selected.includes(value)) {
          onChange([...selected, value]);
        }
      } else {
        onChange(selected.filter((item) => item !== value));
      }
    },
    [onChange, selected]
  );

  const handleClear = useCallback(() => {
    onChange([]);
    setSearch('');
  }, [onChange]);

  const hasSelections = selected.length > 0;
  const triggerText = hasSelections ? `${label} (${selected.length})` : label;

  return (
    <div ref={wrapRef} className={styles.multiSelectWrap} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={[
          styles.multiSelectTrigger,
          hasSelections ? styles.multiSelectTriggerActive : '',
          isOpen ? styles.multiSelectTriggerOpen : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span>{triggerText}</span>
        <IconChevronDown size={14} className={isOpen ? styles.chevronOpen : undefined} />
      </button>

      {isOpen && (
        <div className={styles.multiSelectPopover} role="dialog" aria-label={label}>
          <div className={styles.multiSelectSearch}>
            <IconSearch size={14} className={styles.searchIcon} aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              className={styles.multiSelectSearchInput}
              placeholder={t('usage_stats.filter_search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t('usage_stats.filter_search_placeholder')}
            />
            {search && (
              <button
                type="button"
                className={styles.clearSearchBtn}
                onClick={() => setSearch('')}
                aria-label={t('usage_stats.filter_clear')}
              >
                <IconX size={12} />
              </button>
            )}
          </div>

          <div className={styles.multiSelectHeader}>
            <span className={styles.multiSelectCount}>
              {t('usage_stats.filter_selected_count', {
                count: selected.length,
                total: merged.length,
              })}
            </span>
            {hasSelections && (
              <button type="button" className={styles.multiSelectClearBtn} onClick={handleClear}>
                {t('usage_stats.filter_clear')}
              </button>
            )}
          </div>

          <div className={styles.multiSelectList} role="listbox" aria-label={label}>
            {filtered.length === 0 ? (
              <div className={styles.multiSelectEmpty}>{t('usage_stats.no_matching_options')}</div>
            ) : (
              filtered.map((opt) => {
                const isChecked = selected.includes(opt.value);
                return (
                  <div
                    key={opt.value}
                    role="option"
                    aria-selected={isChecked}
                    className={styles.multiSelectOption}
                  >
                    <SelectionCheckbox
                      checked={isChecked}
                      onChange={(checked) => handleToggle(opt.value, checked)}
                      label={
                        <div className={styles.multiSelectOptionContent}>
                          <span className={styles.multiSelectOptionLabel}>
                            {opt.renderLabel ?? opt.label}
                          </span>
                          {opt.requests !== undefined && (
                            <span className={styles.multiSelectOptionRequests}>{opt.requests}</span>
                          )}
                        </div>
                      }
                      ariaLabel={opt.label}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
