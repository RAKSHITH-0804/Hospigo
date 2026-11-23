import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { staffCopy } from '@/config/staff-copy';

function Harness({ inner }: { inner?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open it
      </button>
      {open ? (
        <Modal title="My dialog" onClose={() => setOpen(false)}>
          <button type="button">First inside</button>
          {inner}
          <button type="button">Last inside</button>
        </Modal>
      ) : null}
    </div>
  );
}

const openIt = () => fireEvent.click(screen.getByRole('button', { name: 'Open it' }));

describe('Modal', () => {
  it('shows a labelled modal dialog and puts focus inside it', () => {
    render(<Harness />);
    openIt();
    const dialog = screen.getByRole('dialog', { name: 'My dialog' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes with the Close button, Escape and a click on the dimmed area, never on a click inside', () => {
    render(<Harness />);
    openIt();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'First inside' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: staffCopy.modal.close }));
    expect(screen.queryByRole('dialog')).toBeNull();
    openIt();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    openIt();
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('gives the page back: scrolling is restored and focus returns to the button that opened it', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(opener);
  });

  it('keeps Tab and Shift+Tab inside the dialog', () => {
    render(<Harness />);
    openIt();
    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: staffCopy.modal.close });
    const last = screen.getByRole('button', { name: 'Last inside' });
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('leaves Escape to a calendar that is open inside it', () => {
    render(<Harness inner={<div role="dialog" aria-label="Inner calendar" />} />);
    openIt();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'My dialog' }), { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'My dialog' })).toBeTruthy();
  });
});
