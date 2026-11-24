import type { DoctorFee, VisitType } from '../../generated/prisma';
import type { TenantTx } from '../../database/tenant-db';

/**
 * Doctor fee lookup (Step 8c fallback, Step 9 branch fees).
 *
 * A doctor has a base fee (the new-visit fee) and an OPTIONAL follow-up fee, and each of them can
 * be set for the whole hospital (branch null) or for one branch. For a visit in branch X:
 *   1. the fee row in effect for branch X (newest row that has started),
 *   2. else the hospital-wide row in effect,
 *   3. else, for a follow-up only, the new-visit fee found the same way (steps 1 and 2),
 *   4. else no fee (the caller answers FEE_NOT_CONFIGURED).
 * A branch fee beats the hospital-wide one whatever their dates (a later hospital-wide change does
 * not touch a branch that has its own fee). Rows are append-only versions: a row that starts in the
 * future is ignored until its date. Bills already made keep the row they used (bill line stores its id).
 */
export type DoctorFeeRow = Pick<
  DoctorFee,
  'id' | 'doctorProfileId' | 'branchId' | 'visitType' | 'amountPaise' | 'effectiveFrom'
>;

/** The row in effect for (type, branch) among rows already filtered to the doctor: branch first, then hospital-wide. */
function inEffect<T extends DoctorFeeRow>(
  rows: readonly T[],
  type: VisitType,
  branchId: string | null,
  at: Date,
): T | null {
  const newest = (branch: string | null): T | null =>
    rows
      .filter(
        (r) =>
          r.visitType === type && r.branchId === branch && r.effectiveFrom.getTime() <= at.getTime(),
      )
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null;
  return (branchId ? newest(branchId) : null) ?? newest(null);
}

/** Pure form of the lookup over the rows of ONE doctor (used for a list of doctors and by resolveDoctorFee). */
export function pickDoctorFee<T extends DoctorFeeRow>(
  rows: readonly T[],
  visitType: VisitType,
  branchId: string | null,
  at: Date,
): { fee: T | null; followsBase: boolean } {
  const own = inEffect(rows, visitType, branchId, at);
  if (own || visitType === 'NEW') {
    return { fee: own, followsBase: false };
  }
  return { fee: inEffect(rows, 'NEW', branchId, at), followsBase: true };
}

export async function resolveDoctorFee(
  tx: TenantTx,
  tenantId: string,
  doctorProfileId: string,
  visitType: VisitType,
  at: Date,
  branchId: string | null = null,
): Promise<{ fee: DoctorFee | null; followsBase: boolean }> {
  const rows = await tx.doctorFee.findMany({
    where: {
      tenantId,
      doctorProfileId,
      effectiveFrom: { lte: at },
      OR: branchId ? [{ branchId }, { branchId: null }] : [{ branchId: null }],
    },
  });
  return pickDoctorFee(rows, visitType, branchId, at);
}
