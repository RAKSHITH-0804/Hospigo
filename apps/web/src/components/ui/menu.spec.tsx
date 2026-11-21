import { fireEvent, render, screen } from '@testing-library/react';
import { ActionMenu } from '@/components/ui/menu';

const done = jest.fn();
const actions = [
  { id: 'a', label: 'Print', onSelect: done },
  { id: 'b', label: 'Save as PDF', onSelect: done },
  { id: 'c', label: 'Download CSV', href: '/file.csv' },
];

function setup() {
  render(
    <div>
      <ActionMenu label="Print and download" actions={actions} />
      <p>outside</p>
    </div>,
  );
  return screen.getByRole('button', { name: 'Print and download' });
}

beforeEach(() => done.mockReset());

describe('ActionMenu', () => {
  it('is closed until the button is clicked, then lists the actions', () => {
    const trigger = setup();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Print',
      'Save as PDF',
      'Download CSV',
    ]);
  });

  it('a link action is a real link, a button action runs and the menu closes', () => {
    const trigger = setup();
    fireEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Download CSV' }).getAttribute('href')).toBe(
      '/file.csv',
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Print' }));
    expect(done).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes with Escape (focus back on the button) and with a click outside', () => {
    const trigger = setup();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('the arrow keys, Home and End move through the items and wrap around', () => {
    const trigger = setup();
    fireEvent.click(trigger);
    const items = screen.getAllByRole('menuitem');
    items[0]!.focus();
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('a click on the button again closes it', () => {
    const trigger = setup();
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
