import { useId, useMemo } from 'react';
import {
  ExcludedModelsPicker,
  normalizeExcludedRules,
  type ExcludedModelCandidate,
  type ExcludedModelsCatalogState,
  type ModelRulesTone,
} from '@/components/excludedModels';

interface ClientKeyModelRulesFieldProps {
  label: string;
  hint: string;
  tone: ModelRulesTone;
  value: readonly string[];
  onChange: (next: string[]) => void;
  candidates: readonly ExcludedModelCandidate[];
  catalogState: ExcludedModelsCatalogState;
  onRetry: () => void;
  disabled: boolean;
}

export function ClientKeyModelRulesField({
  label,
  hint,
  tone,
  value,
  onChange,
  candidates,
  catalogState,
  onRetry,
  disabled,
}: ClientKeyModelRulesFieldProps) {
  const labelId = useId();
  const merged = useMemo(() => {
    const byId = new Map<string, ExcludedModelCandidate>();
    candidates.forEach((candidate) => {
      const id = candidate.id.trim();
      if (id) byId.set(id.toLowerCase(), { ...candidate, id });
    });
    // Saved exact rules missing from the live catalog still need a row, or they vanish.
    normalizeExcludedRules(value).forEach((rule) => {
      if (rule.includes('*') || byId.has(rule.toLowerCase())) return;
      byId.set(rule.toLowerCase(), { id: rule });
    });
    return [...byId.values()].sort((left, right) =>
      left.id.localeCompare(right.id, undefined, { sensitivity: 'base' })
    );
  }, [candidates, value]);

  return (
    <div className="form-group">
      <label id={labelId}>{label}</label>
      <ExcludedModelsPicker
        tone={tone}
        value={value}
        onChange={onChange}
        candidates={merged}
        catalogState={catalogState}
        onRetryCatalog={onRetry}
        disabled={disabled}
        labelledBy={labelId}
      />
      <div className="hint">{hint}</div>
    </div>
  );
}
