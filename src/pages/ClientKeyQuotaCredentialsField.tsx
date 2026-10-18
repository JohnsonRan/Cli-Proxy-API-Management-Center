import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExcludedModelChipRow, ExcludedModelRuleChip } from '@/components/excludedModels';
import pickerStyles from '@/components/excludedModels/ExcludedModelsPicker.module.scss';
import { IconCheck, IconChevronDown, IconLoader2, IconSearch } from '@/components/ui/icons';
import { authFilesApi } from '@/services/api/authFiles';
import { useConfigStore } from '@/stores';
import type { AuthFileItem } from '@/types/authFile';
import {
  buildQuotaCredentialOptions,
  buildQuotaRelayOptions,
  filterQuotaCredentialOptions,
  loadQuotaCredentialsSources,
  type QuotaCredentialOption,
} from '@/utils/quotaCredentials';

interface ClientKeyQuotaCredentialsFieldProps {
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Credentials a client key may read through GET /v1/usage, drawn like the model allow and
 * exclude pickers above it: a summary trigger, a searchable list in a disclosure and the
 * selection as removable chips.
 */
export function ClientKeyQuotaCredentialsField({
  value,
  onChange,
  disabled,
}: ClientKeyQuotaCredentialsFieldProps) {
  const { t } = useTranslation();
  const labelId = useId();
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const listboxId = `${baseId}-listbox`;
  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const config = useConfigStore((store) => store.config);
  const fetchConfig = useConfigStore((store) => store.fetchConfig);

  const load = useCallback(async () => {
    setState('loading');
    const result = await loadQuotaCredentialsSources(
      () => authFilesApi.list(),
      () => fetchConfig()
    );
    if (result.state === 'ready') {
      setFiles(result.files);
      setState('ready');
    } else {
      setState('error');
    }
  }, [fetchConfig]);

  useEffect(() => {
    void load();
  }, [load]);

  // Until the list arrives every saved ID would look removed, so list nothing before then.
  const options = useMemo(
    () =>
      state === 'ready'
        ? buildQuotaCredentialOptions(files, value, buildQuotaRelayOptions(config))
        : [],
    [config, files, state, value]
  );
  const selected = useMemo(() => new Set(value), [value]);
  const available = useMemo(() => options.filter((option) => !option.missing), [options]);
  const selectedCount = available.filter((option) => selected.has(option.id)).length;

  const toggle = (id: string, checked: boolean) => {
    onChange(checked ? [...value, id] : value.filter((item) => item !== id));
  };
  const selectAll = () => {
    const next = [...value];
    available.forEach((option) => {
      if (!selected.has(option.id)) next.push(option.id);
    });
    onChange(next);
  };

  const dismissPanel = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const summary =
    state === 'loading'
      ? t('api_keys_page.quota_credentials.loading')
      : state === 'error'
        ? t('api_keys_page.quota_credentials.load_failed')
        : value.length === 0
          ? t('api_keys_page.quota_credentials.trigger_empty')
          : t('api_keys_page.quota_credentials.trigger_summary', {
              selected: selectedCount,
              total: available.length,
            });
  const chips = options.filter((option) => selected.has(option.id));

  return (
    <div className="form-group">
      <label id={labelId}>{t('api_keys_page.quota_credentials.label')}</label>
      <div className={pickerStyles.root}>
        <button
          ref={triggerRef}
          type="button"
          className={`${pickerStyles.trigger} ${open ? pickerStyles.triggerOpen : ''}`.trim()}
          onClick={() => setOpen((prev) => !prev)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && !open) {
              event.preventDefault();
              setOpen(true);
            } else if (event.key === 'Escape' && open) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
          }}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-labelledby={labelId}
          disabled={disabled}
        >
          <span className={pickerStyles.triggerText}>
            {state === 'loading' ? (
              <IconLoader2 size={13} className={pickerStyles.triggerSpinner} aria-hidden="true" />
            ) : null}
            {summary}
          </span>
          <IconChevronDown size={14} className={pickerStyles.chevron} aria-hidden="true" />
          {state === 'ready' && available.length > 0 ? (
            <span
              className={pickerStyles.meter}
              role="img"
              aria-label={t('api_keys_page.quota_credentials.trigger_summary', {
                selected: selectedCount,
                total: available.length,
              })}
            >
              <span
                className={pickerStyles.meterFill}
                style={{ width: `${(selectedCount / available.length) * 100}%` }}
              />
            </span>
          ) : null}
        </button>

        <div
          id={panelId}
          className={`${pickerStyles.disclosure} ${open ? pickerStyles.disclosureOpen : ''}`.trim()}
        >
          <div className={pickerStyles.disclosureInner} inert={!open}>
            {state === 'ready' ? (
              <QuotaCredentialsPanel
                options={options}
                selected={selected}
                selectedCount={selectedCount}
                total={available.length}
                onToggle={toggle}
                onSelectAll={selectAll}
                onClear={() => onChange([])}
                disabled={disabled}
                listboxId={listboxId}
                autoFocus={open}
                onDismiss={dismissPanel}
              />
            ) : (
              <div className={pickerStyles.catalogNotice}>
                <span>
                  {state === 'loading'
                    ? t('api_keys_page.quota_credentials.loading')
                    : t('api_keys_page.quota_credentials.load_failed')}
                </span>
                {state === 'error' ? (
                  <button
                    type="button"
                    className={pickerStyles.retryButton}
                    onClick={() => void load()}
                    disabled={disabled}
                  >
                    {t('api_keys_page.quota_credentials.retry')}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {chips.length > 0 ? (
          <ExcludedModelChipRow>
            {chips.map((option) => (
              <ExcludedModelRuleChip
                key={option.id}
                label={option.label}
                variant={option.missing ? 'unknown' : 'exact'}
                detail={optionFlags(t, option)[0]}
                title={option.id}
                onRemove={() => toggle(option.id, false)}
                removeAriaLabel={t('api_keys_page.quota_credentials.chip_remove', {
                  name: option.label,
                })}
                disabled={disabled}
              />
            ))}
          </ExcludedModelChipRow>
        ) : null}
      </div>
      <div className="hint">{t('api_keys_page.quota_credentials.hint')}</div>
    </div>
  );
}

type Translate = ReturnType<typeof useTranslation>['t'];

/** Why an option needs a second look, most important first. */
const optionFlags = (t: Translate, option: QuotaCredentialOption): string[] => {
  const flags: string[] = [];
  if (option.missing) flags.push(t('api_keys_page.quota_credentials.missing'));
  if (option.disabled) flags.push(t('api_keys_page.quota_credentials.disabled'));
  if (option.ownKey) flags.push(t('api_keys_page.quota_credentials.own_key'));
  return flags;
};

interface QuotaCredentialsPanelProps {
  options: readonly QuotaCredentialOption[];
  selected: ReadonlySet<string>;
  selectedCount: number;
  total: number;
  onToggle: (id: string, checked: boolean) => void;
  onSelectAll: () => void;
  onClear: () => void;
  disabled: boolean;
  listboxId: string;
  autoFocus: boolean;
  onDismiss: () => void;
}

/** Same keyboard model as the model picker panel: focus stays in the search box. */
function QuotaCredentialsPanel({
  options,
  selected,
  selectedCount,
  total,
  onToggle,
  onSelectAll,
  onClear,
  disabled,
  listboxId,
  autoFocus,
  onDismiss,
}: QuotaCredentialsPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const visible = useMemo(() => filterQuotaCredentialOptions(options, query), [options, query]);
  const activeIndex = visible.length === 0 ? -1 : Math.min(highlight, visible.length - 1);
  const activeId = activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined;

  useLayoutEffect(() => {
    if (!autoFocus) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  useEffect(() => {
    if (!autoFocus || activeIndex < 0) return;
    document
      .getElementById(`${listboxId}-opt-${activeIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, autoFocus, listboxId]);

  const toggleAt = (index: number) => {
    const option = visible[index];
    if (!option || disabled) return;
    onToggle(option.id, !selected.has(option.id));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setHighlight((prev) => Math.min(prev + 1, visible.length - 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setHighlight((prev) => Math.max(prev - 1, 0));
        return;
      case 'Home':
        if (visible.length === 0) return;
        event.preventDefault();
        setHighlight(0);
        return;
      case 'End':
        if (visible.length === 0) return;
        event.preventDefault();
        setHighlight(visible.length - 1);
        return;
      case 'Enter':
        event.preventDefault();
        if (activeIndex >= 0) toggleAt(activeIndex);
        return;
      case 'Escape':
        // The dialog also listens for Escape; keep it from closing along with the panel.
        event.preventDefault();
        event.stopPropagation();
        if (query) {
          setQuery('');
          setHighlight(0);
          return;
        }
        onDismiss();
        return;
      default:
    }
  };

  return (
    <div className={pickerStyles.panel}>
      <div className={pickerStyles.searchRow}>
        <IconSearch size={14} className={pickerStyles.searchIcon} aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          className={pickerStyles.search}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder={t('api_keys_page.quota_credentials.search_placeholder')}
          aria-label={t('api_keys_page.quota_credentials.search_placeholder')}
          aria-controls={listboxId}
          aria-activedescendant={activeId}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div
        id={listboxId}
        className={pickerStyles.list}
        role="listbox"
        aria-multiselectable="true"
        aria-label={t('api_keys_page.quota_credentials.label')}
      >
        {visible.length === 0 ? (
          <p className={pickerStyles.noResults}>
            {query.trim()
              ? t('api_keys_page.quota_credentials.no_results', { query: query.trim() })
              : t('api_keys_page.quota_credentials.empty')}
          </p>
        ) : (
          visible.map((option, index) => {
            const checked = selected.has(option.id);
            const flags = optionFlags(t, option);
            const rowClass = [
              pickerStyles.row,
              checked ? pickerStyles.rowExcluded : '',
              index === activeIndex ? pickerStyles.rowHighlighted : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <div
                key={option.id}
                id={`${listboxId}-opt-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={checked}
                className={rowClass}
                title={option.id}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => toggleAt(index)}
              >
                <span className={pickerStyles.checkbox} aria-hidden="true">
                  {checked ? <IconCheck size={12} /> : null}
                </span>
                <span className={pickerStyles.rowText}>
                  <span className={pickerStyles.rowId}>{option.label}</span>
                  {!option.label.includes(option.id) ? (
                    <span className={pickerStyles.rowDisplayName}>{option.id}</span>
                  ) : null}
                  {flags.length > 0 ? (
                    <span className={pickerStyles.rowReason}>{flags.join(' · ')}</span>
                  ) : null}
                </span>
                {option.provider ? (
                  <span className={`${pickerStyles.badge} ${pickerStyles.badgeMuted}`}>
                    {option.provider}
                  </span>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <div className={pickerStyles.footer}>
        <span className={pickerStyles.footerCount}>
          {t('api_keys_page.quota_credentials.trigger_summary', {
            selected: selectedCount,
            total,
          })}
        </span>
        <span className={pickerStyles.footerActions}>
          <button
            type="button"
            className={pickerStyles.footerButton}
            onClick={onSelectAll}
            disabled={disabled || total === 0}
          >
            {t('api_keys_page.quota_credentials.select_all')}
          </button>
          <button
            type="button"
            className={pickerStyles.footerButton}
            onClick={onClear}
            disabled={disabled}
          >
            {t('api_keys_page.quota_credentials.clear')}
          </button>
        </span>
      </div>
    </div>
  );
}
