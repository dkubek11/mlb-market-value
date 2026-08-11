/**
 * useSort — port of the legacy header-click sort state machine
 * (dashboard_template.html.bak:1637-1653). Each table owns a { key, dir }
 * pair; clicking the current column toggles desc -> asc, clicking any other
 * column resets to desc. Numeric and string values compare like the legacy
 * renderers (typeof string ? localeCompare : numeric diff).
 */
import { useCallback, useState } from 'react';

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export function useSort(initial: SortState) {
  const [sort, setSort] = useState<SortState>(initial);
  const toggle = useCallback((key: string) => {
    setSort(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc',
    }));
  }, []);
  return { sort, toggle };
}

/** Legacy comparator: strings localeCompare, everything else numeric. */
export function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  return (a as number) - (b as number);
}

/** Apply a SortState to a copy of rows (legacy .sort in place, we copy). */
export function applySort<T>(rows: T[], sort: SortState, get: (row: T) => unknown): T[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    const cmp = compareValues(get(a), get(b));
    return sort.dir === 'asc' ? cmp : -cmp;
  });
  return copy;
}
