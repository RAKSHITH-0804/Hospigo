import { staffCopy } from '@/config/staff-copy';

/**
 * The token of a visit as words. A cancelled visit keeps its token number for the record (it is never
 * given to another patient), and the number is shown as cancelled, for example "T7 cancelled".
 */
export function tokenText(label: string, visitStatus: string | undefined): string {
  return visitStatus === 'CANCELLED' ? `${label} ${staffCopy.opd.tokenCancelled}` : label;
}
