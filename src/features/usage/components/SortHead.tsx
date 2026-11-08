import { TableHead } from '@/components/ui/Table';
import type { SortState } from '../logic';
import styles from '../UsagePage.module.scss';

/** Column header that sorts its table when clicked. */
export function SortHead({
  label,
  sortKey,
  text,
  alignRight,
  sort,
  onSort,
}: {
  label: string;
  sortKey: string;
  text?: boolean;
  alignRight?: boolean;
  sort: SortState | null;
  onSort: (key: string, text?: boolean) => void;
}) {
  const dir = sort?.key === sortKey ? sort.dir : null;
  return (
    <TableHead
      alignRight={alignRight}
      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
    >
      <button
        type="button"
        className={dir ? styles.sortButtonActive : styles.sortButton}
        onClick={() => onSort(sortKey, text)}
      >
        {label}
        <span className={styles.sortIcon} aria-hidden="true">
          {dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕'}
        </span>
      </button>
    </TableHead>
  );
}
