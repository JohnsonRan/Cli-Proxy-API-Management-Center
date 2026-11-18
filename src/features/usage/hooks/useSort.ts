import { useCallback, useState } from 'react';
import { nextSort, type SortState } from '../logic';

/** Sort state of one table; `toggle` cycles a column through its directions and back. */
export function useSort() {
  const [sort, setSort] = useState<SortState | null>(null);
  const toggle = useCallback(
    (key: string, text?: boolean) => setSort((current) => nextSort(current, key, text)),
    []
  );
  return { sort, toggle };
}
