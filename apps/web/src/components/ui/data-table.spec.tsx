import { fireEvent, render, screen } from '@testing-library/react';
import { DataTable } from '@/components/ui/data-table';

describe('DataTable sortable headers', () => {
  it('renders sort buttons with aria-sort and toggles via onSort', () => {
    const onSort = jest.fn();
    render(
      <DataTable
        ariaLabel="Demo"
        rows={[{ id: '1' }]}
        columns={[
          {
            id: 'name',
            header: 'Name',
            cell: () => 'Ada',
            sortable: true,
            sortDirection: 'asc',
            sortAriaLabel: 'Sort Name ascending',
            onSort,
          },
          { id: 'age', header: 'Age', cell: () => '30' },
        ]}
      />,
    );
    const th = screen.getByRole('columnheader', { name: /Name/ });
    expect(th.getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(screen.getByRole('button', { name: 'Sort Name ascending' }));
    expect(onSort).toHaveBeenCalledTimes(1);
  });
});
