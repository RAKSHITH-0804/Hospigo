import fs from 'fs';
import path from 'path';
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

describe('DataTable on a phone', () => {
  const rows = [{ id: '1' }];
  const columns = [
    { id: 'name', header: 'Name', cell: () => 'Ada' },
    { id: 'phone', header: 'Phone', cell: () => '+91 98765 43210', nowrap: true },
    { id: 'branch', header: 'Branch', cell: () => 'Main', hideOnPhone: true },
  ];

  it('marks the columns that a phone drops or never wraps, in the header and in every row', () => {
    render(<DataTable ariaLabel="Demo" rows={rows} columns={columns} />);
    expect(screen.getByRole('columnheader', { name: 'Branch' }).className).toContain(
      'data-table-hide-phone',
    );
    expect(screen.getByRole('columnheader', { name: 'Name' }).className).not.toContain(
      'data-table-hide-phone',
    );
    expect(screen.getByText('Main').className).toContain('data-table-hide-phone');
    expect(screen.getByText('+91 98765 43210').className).toContain('data-table-nowrap');
    expect(screen.getByText('Ada').className).not.toContain('data-table-nowrap');
  });

  it('gives every cell its column name, for the card layout of a phone', () => {
    render(<DataTable ariaLabel="Demo" rows={rows} columns={columns} />);
    expect(screen.getByText('Ada').getAttribute('data-label')).toBe('Name');
    expect(screen.getByText('Main').getAttribute('data-label')).toBe('Branch');
  });

  it('stackOnPhone only adds a class; the table is still a real table with its headers', () => {
    const { rerender } = render(<DataTable ariaLabel="Demo" rows={rows} columns={columns} />);
    expect(screen.getByRole('table').className).not.toContain('data-table-stack');
    rerender(<DataTable ariaLabel="Demo" rows={rows} columns={columns} stackOnPhone />);
    expect(screen.getByRole('table').className).toContain('data-table-stack');
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
  });

  it('the phone rules exist in the style sheet', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../app/globals.css'), 'utf8');
    expect(css).toMatch(
      /@media \(width < 40rem\)[\s\S]*\.data-table-hide-phone\s*\{\s*display: none/,
    );
    expect(css).toMatch(/\.data-table-stack tr\s*\{[^}]*display: flex/);
  });
});
