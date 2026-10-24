import { useTranslation } from 'react-i18next';
import type { UsageHeatCell } from '@/services/api/usageStore';
import { formatCompact, formatCost, type UsageMetric } from '../format';
import styles from '../UsagePage.module.scss';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
// Monday first, as most locales read a week.
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

const cellValue = (cell: UsageHeatCell | undefined, metric: UsageMetric) =>
  !cell ? 0 : metric === 'requests' ? cell.requests : metric === 'tokens' ? cell.tokens : cell.cost;

/** Weekday x hour grid; opacity scales with the cell's share of the busiest cell. */
export function ActivityHeatmap({
  cells,
  metric,
}: {
  cells: UsageHeatCell[];
  metric: UsageMetric;
}) {
  const { t, i18n } = useTranslation();
  const byKey = new Map(cells.map((c) => [`${c.weekday}:${c.hour}`, c]));
  const max = Math.max(0, ...cells.map((c) => cellValue(c, metric)));
  const dayName = (weekday: number) =>
    // 2023-01-01 was a Sunday.
    new Date(Date.UTC(2023, 0, 1 + weekday)).toLocaleDateString(i18n.language, {
      weekday: 'short',
      timeZone: 'UTC',
    });
  const format = (value: number) => (metric === 'cost' ? formatCost(value) : formatCompact(value));

  return (
    <div className={styles.heatmap} role="table" aria-label={t('usage_stats.heatmap_title')}>
      <div className={styles.heatRow} role="row">
        <span className={styles.heatDay} role="columnheader" />
        {HOURS.map((hour) => (
          <span key={hour} className={styles.heatHour} role="columnheader">
            {hour % 3 === 0 ? hour : ''}
          </span>
        ))}
      </div>
      {WEEKDAYS.map((weekday) => (
        <div key={weekday} className={styles.heatRow} role="row">
          <span className={styles.heatDay} role="rowheader">
            {dayName(weekday)}
          </span>
          {HOURS.map((hour) => {
            const cell = byKey.get(`${weekday}:${hour}`);
            const value = cellValue(cell, metric);
            const label = t('usage_stats.heatmap_cell', {
              day: dayName(weekday),
              hour: String(hour).padStart(2, '0'),
              value: format(value),
              failed: formatCompact(cell?.failed ?? 0),
            });
            return (
              <span
                key={hour}
                role="cell"
                className={styles.heatCell}
                style={{ opacity: value > 0 && max > 0 ? 0.15 + 0.85 * (value / max) : 1 }}
                data-empty={value === 0 ? 'true' : undefined}
                title={label}
                aria-label={label}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
