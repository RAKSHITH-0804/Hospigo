import { staffCopy } from '@/config/staff-copy';
import { fill } from './clinical-format';
import { statusKind } from './tests-draft';

const copy = staffCopy.opd.tests.doctor;

/**
 * The words for a test's status. A status this version does not know (added by a later step, for
 * example a lab result) gets a neutral label instead of breaking the screen.
 */
export function orderStatusText(status: string, notTakenReason: string | null): string {
  switch (statusKind(status)) {
    case 'ordered':
      return copy.statusOrdered;
    case 'billed':
      return copy.statusBilled;
    case 'notTaken':
      return fill(copy.statusNotTaken, { reason: notTakenReason ?? '' });
    default:
      return copy.statusOther;
  }
}
