import { fireEvent, render, screen } from '@testing-library/react';
import { Badge } from './badge';
import { DataTable } from './data-table';
import { InputField, SelectField } from './field';
import { Kbd } from './kbd';
import { PageHeader } from './page-header';
import { Pagination } from './pagination';
import { Tabs } from './tabs';

describe('UI kit', () => {
  it('Badge renders variant text', () => {
    render(<Badge variant="success">Paid</Badge>);
    expect(screen.getByText('Paid')).toBeTruthy();
  });

  it('InputField binds label and surfaces errors with role alert', () => {
    render(<InputField label="Full name" error="Required" />);
    const input = screen.getByLabelText('Full name');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Required');
  });

  it('SelectField renders options', () => {
    render(
      <SelectField label="Gender">
        <option value="F">F</option>
      </SelectField>,
    );
    expect(screen.getByLabelText('Gender')).toBeTruthy();
  });

  it('Tabs expose tablist/tab and move with arrows', () => {
    const onChange = jest.fn();
    render(
      <Tabs
        items={[
          { value: 'a', label: 'One' },
          { value: 'b', label: 'Two' },
        ]}
        value="a"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('tablist')).toBeTruthy();
    const tab = screen.getByRole('tab', { name: 'One' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('DataTable uses semantic table markup', () => {
    render(
      <DataTable
        caption="People"
        columns={[{ id: 'n', header: 'Name', cell: (r) => r.name }]}
        rows={[{ id: '1', name: 'Ada' }]}
      />,
    );
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText('Ada')).toBeTruthy();
  });

  it('Pagination disables edges and labels pages', () => {
    const onPrevious = jest.fn();
    const onNext = jest.fn();
    render(
      <Pagination
        page={1}
        totalPages={3}
        total={30}
        previousLabel="Previous"
        nextLabel="Next"
        pageOfLabel="Page {page} of {totalPages}"
        totalLabel="{total} total"
        onPrevious={onPrevious}
        onNext={onNext}
      />,
    );
    expect(screen.getByText(/Page 1 of 3/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalled();
  });

  it('Kbd and PageHeader render', () => {
    render(
      <>
        <Kbd>Esc</Kbd>
        <PageHeader
          title="Patients"
          description="Search"
          actions={<button type="button">Add</button>}
        />
      </>,
    );
    expect(screen.getByText('Esc')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Patients' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
  });
});
