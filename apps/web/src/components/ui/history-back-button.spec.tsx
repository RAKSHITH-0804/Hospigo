import { fireEvent, render, screen } from '@testing-library/react';
import { HistoryBackButton } from '@/components/ui/history-back-button';
import { PageHeader } from '@/components/ui/page-header';
import { staffCopy } from '@/config/staff-copy';

const back = jest.fn();
const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ back, push }),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function historyLength(length: number) {
  Object.defineProperty(window.history, 'length', { configurable: true, value: length });
}

beforeEach(() => {
  back.mockReset();
  push.mockReset();
  historyLength(3);
});

describe('HistoryBackButton', () => {
  it('goes back to the page that was open before', () => {
    render(<HistoryBackButton fallbackHref="/app" />);
    fireEvent.click(screen.getByRole('button', { name: staffCopy.back }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('goes to the fallback when there is no page before (a new tab or a typed address)', () => {
    historyLength(1);
    render(<HistoryBackButton fallbackHref="/app" />);
    fireEvent.click(screen.getByRole('button', { name: staffCopy.back }));
    expect(push).toHaveBeenCalledWith('/app');
    expect(back).not.toHaveBeenCalled();
  });

  it('is hidden when printing', () => {
    render(<HistoryBackButton fallbackHref="/app" />);
    expect(screen.getByRole('button', { name: staffCopy.back }).className).toContain('no-print');
  });
});

describe('PageHeader back controls', () => {
  it('backToPrevious shows the history back button; backHref still shows a plain link', () => {
    const first = render(<PageHeader title="Mine" backToPrevious="/app" />);
    expect(screen.getByRole('button', { name: staffCopy.back })).toBeTruthy();
    expect(screen.queryByRole('link', { name: staffCopy.back })).toBeNull();
    first.unmount();
    render(<PageHeader title="Other" backHref="/app/opd" />);
    expect(screen.getByRole('link', { name: staffCopy.back }).getAttribute('href')).toBe(
      '/app/opd',
    );
    expect(screen.queryByRole('button', { name: staffCopy.back })).toBeNull();
  });

  it('has no back control by default', () => {
    render(<PageHeader title="Plain" />);
    expect(screen.queryByTestId('page-header-back')).toBeNull();
  });
});
