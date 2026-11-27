import { render, screen } from '@testing-library/react';
import { AllBranchesToggle } from '@/components/shell/all-branches-toggle';
import { staffCopy } from '@/config/staff-copy';

const copy = staffCopy.allBranches;

describe('AllBranchesToggle', () => {
  it('offers the combined view as a plain link and a way back', () => {
    const { unmount } = render(<AllBranchesToggle href="/app/opd" active={false} />);
    expect(screen.getByRole('link', { name: copy.on }).getAttribute('href')).toBe(
      '/app/opd?branch=ALL',
    );
    expect(screen.queryByText(copy.note)).toBeNull();
    unmount();
    render(<AllBranchesToggle href="/app/opd" active />);
    expect(screen.getByRole('link', { name: copy.off }).getAttribute('href')).toBe('/app/opd');
    expect(screen.getByText(copy.note)).toBeTruthy();
  });
});
