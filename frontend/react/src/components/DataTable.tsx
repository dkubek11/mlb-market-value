/**
 * DataTable — shared sortable table used by PlayersView / RookiesView (and
 * later TeamsView / CustomScoreView). Mirrors the legacy <table> markup:
 * sortable <th data-sort>, .num right-aligned cells, .table-scroll wrapper,
 * and the .empty state row when there are no rows.
 */
import { Fragment, type ReactNode } from 'react';
import type { SortState } from '../hooks/useSort';

export interface Column<T> {
  /** Sort key (legacy th[data-sort]); omit to make the column non-sortable. */
  key?: string;
  /** Header label. */
  label: string;
  /** Right-align (legacy .num). */
  num?: boolean;
  /** Render the cell. */
  render: (row: T) => ReactNode;
  /** Optional custom getter for sorting (defaults to row[key]). */
  sortValue?: (row: T) => unknown;
}

interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  sort: SortState;
  onSort: (key: string) => void;
  /** colspan for the empty-state row (legacy hardcodes 6/5). */
  emptyColspan: number;
  /** Empty-state message (legacy: "No players match that search." etc.). */
  emptyMessage: string;
  /** Rows are clickable to open the player card. */
  rowClick?: (row: T) => void;
  /**
   * Legacy expandable rows: after a row whose `isExpanded(row)` is true, render
   * `expandedRow(row)` inside a full-width <tr> (legacy .diamond-row/.detail-row
   * with a single td[colspan]). Used by TeamsView (diamond panel) and
   * CustomScoreView (score-breakdown detail row).
   */
  isExpanded?: (row: T) => boolean;
  expandedRow?: (row: T) => ReactNode;
}

export function DataTable<T>({ columns, rows, sort, onSort, emptyColspan, emptyMessage, rowClick, isExpanded, expandedRow }: DataTableProps<T>) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map(c => (
              <th
                key={c.label}
                className={c.num ? 'num' : undefined}
                data-sort={c.key}
                aria-sort={c.key === sort.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                onClick={c.key ? () => onSort(c.key!) : undefined}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={emptyColspan}>
                <div className="empty">{emptyMessage}</div>
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <Fragment key={i}>
                <tr
                  className="row-toggle"
                  onClick={rowClick ? () => rowClick(row) : undefined}
                >
                  {columns.map(c => (
                    <td key={c.label} className={c.num ? 'num' : undefined}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
                {isExpanded && expandedRow && isExpanded(row) ? (
                  <tr className="diamond-row detail-row">
                    <td colSpan={columns.length}>{expandedRow(row)}</td>
                  </tr>
                ) : null}
              </Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
