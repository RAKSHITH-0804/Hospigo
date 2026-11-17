import { act, fireEvent, render, screen } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Tooltip } from '@/components/ui/tooltip';

function mockRect(el: Element, rect: Partial<DOMRect>) {
  el.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, ...rect }) as DOMRect;
}

describe('Tooltip (portal)', () => {
  it('renders no tooltip markup on the server', () => {
    const html = renderToString(
      <Tooltip content="Full text">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    expect(html).toContain('Trigger');
    expect(html).not.toContain('role="tooltip"');
    expect(html).not.toContain('Full text');
  });

  it('hydrates server markup without a mismatch, then opens in a portal after mount', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToString(
      <Tooltip content="Full text">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    let hydrated: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      hydrated = hydrateRoot(
        container,
        <Tooltip content="Full text">
          <button type="button">Trigger</button>
        </Tooltip>,
      );
    });
    expect(errors).not.toHaveBeenCalled();
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(container.querySelector('.ui-tooltip-root')!);
    const tip = await screen.findByRole('tooltip');
    expect(container.contains(tip)).toBe(false);
    expect(tip.parentElement).toBe(document.body);
    await act(async () => {
      hydrated?.unmount();
    });
    errors.mockRestore();
    container.remove();
  });

  it('is fixed-positioned to the right of the trigger and not inside it', async () => {
    render(
      <Tooltip content="Expand sidebar">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const root = document.querySelector('.ui-tooltip-root')!;
    mockRect(root, { top: 100, height: 40, left: 8, right: 72, width: 64, bottom: 140 });
    fireEvent.mouseEnter(root);
    const tip = await screen.findByRole('tooltip');
    expect(root.contains(tip)).toBe(false);
    expect(tip.getAttribute('data-side')).toBe('right');
    expect(tip.style.top).toBe('120px');
    expect(tip.style.left).toBe('72px');
    expect(screen.getByRole('button', { name: 'Trigger' }).getAttribute('aria-describedby')).toBe(
      tip.id,
    );
  });

  it('positions below the trigger for side bottom', async () => {
    render(
      <Tooltip content="Hospital" side="bottom">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const root = document.querySelector('.ui-tooltip-root')!;
    mockRect(root, { top: 10, bottom: 30, left: 20, right: 120, width: 100, height: 20 });
    fireEvent.mouseEnter(root);
    const tip = await screen.findByRole('tooltip');
    expect(tip.getAttribute('data-side')).toBe('bottom');
    expect(tip.style.top).toBe('30px');
    expect(tip.style.left).toBe('70px');
  });

  it('closes on Escape, mouse leave, resize and scroll, and on blur', async () => {
    render(
      <Tooltip content="Text">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const root = document.querySelector('.ui-tooltip-root')!;
    const button = screen.getByRole('button', { name: 'Trigger' });

    fireEvent.mouseEnter(root);
    await screen.findByRole('tooltip');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(root);
    await screen.findByRole('tooltip');
    fireEvent.mouseLeave(root);
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(root);
    await screen.findByRole('tooltip');
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(root);
    await screen.findByRole('tooltip');
    fireEvent.scroll(document.body);
    expect(screen.queryByRole('tooltip')).toBeNull();

    button.focus();
    fireEvent.focus(button);
    await screen.findByRole('tooltip');
    button.blur();
    fireEvent.blur(button);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
