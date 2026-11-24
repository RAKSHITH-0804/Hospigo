import { render, screen } from '@testing-library/react';
import { VisitHeader } from '@/components/opd/visit-header';
import { staffCopy } from '@/config/staff-copy';
import { makeVisit } from '@/lib/opd/clinical-test-fixtures';
import { tokenText } from '@/lib/opd/token-label';

const word = staffCopy.opd.tokenCancelled;

describe('the token of a cancelled visit', () => {
  it('is shown as cancelled with its number, and a live visit shows the number alone', () => {
    expect(tokenText('T7', 'CANCELLED')).toBe(`T7 ${word}`);
    for (const status of [
      'WAITING',
      'IN_CONSULTATION',
      'COMPLETED',
      'AWAITING_PAYMENT',
      undefined,
    ]) {
      expect(tokenText('T7', status)).toBe('T7');
    }
  });

  it('the visit header says so, and the number stays on the visit', () => {
    const { unmount } = render(<VisitHeader visit={makeVisit({ status: 'CANCELLED' })} />);
    expect(screen.getByLabelText(staffCopy.opd.clinical.patient.token).textContent).toBe(
      `T7 ${word}`,
    );
    unmount();
    render(<VisitHeader visit={makeVisit({ status: 'WAITING' })} />);
    expect(screen.getByLabelText(staffCopy.opd.clinical.patient.token).textContent).toBe('T7');
  });
});
