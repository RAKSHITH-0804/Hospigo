import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type DataTableSortDirection = 'asc' | 'desc';

export type DataTableColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** When set, header becomes a sort button. */
  sortable?: boolean;
  sortDirection?: DataTableSortDirection | null;
  sortAriaLabel?: string;
  onSort?: () => void;
};

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  caption,
  ariaLabel,
  selectedId,
  onRowSelect,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  caption?: string;
  ariaLabel?: string;
  selectedId?: string;
  onRowSelect?: (id: string) => void;
}) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-left" aria-label={ariaLabel}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="bg-[var(--table-header)]">
          <tr>
            {columns.map((col) => {
              const ariaSort =
                col.sortable && col.sortDirection
                  ? col.sortDirection === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : col.sortable
                    ? 'none'
                    : undefined;
              return (
                <th
                  key={col.id}
                  scope="col"
                  aria-sort={ariaSort}
                  className="border-b border-[var(--row-divider)] px-[var(--space-table-x)] py-[var(--space-table-y)] type-label font-semibold text-foreground"
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      className="data-table-sort inline-flex items-center gap-[var(--space-1)]"
                      aria-label={col.sortAriaLabel ?? col.header}
                      onClick={col.onSort}
                    >
                      <span>{col.header}</span>
                      {col.sortDirection === 'asc' ? (
                        <ArrowUp aria-hidden="true" className="size-[var(--size-icon-menu)]" />
                      ) : col.sortDirection === 'desc' ? (
                        <ArrowDown aria-hidden="true" className="size-[var(--size-icon-menu)]" />
                      ) : (
                        <ArrowUpDown aria-hidden="true" className="size-[var(--size-icon-menu)]" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = selectedId === row.id;
            return (
              <tr
                key={row.id}
                aria-selected={selected || undefined}
                className={cn(
                  'border-b border-[var(--row-divider)]',
                  selected ? 'bg-accent' : undefined,
                  onRowSelect ? 'cursor-pointer' : undefined,
                )}
                onClick={onRowSelect ? () => onRowSelect(row.id) : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className="px-[var(--space-table-x)] py-[var(--space-table-y)] type-label text-foreground"
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
