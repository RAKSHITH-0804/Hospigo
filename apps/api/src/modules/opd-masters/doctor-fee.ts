import type { DoctorFee, VisitType } from '../../generated/prisma';
import type { TenantTx } from '../../database/tenant-db';

/**
 * Step 8c: a doctor has a base fee (the new-visit fee) and an OPTIONAL follow-up fee. The follow-up
 * fee is its own price only when the hospital set one; with none, a follow-up visit uses the
 * new-visit fee. A separate follow-up fee, once set, stays as it is when the new-visit fee changes
 * (rows are append-only; typing the same amount is the way back to "same price").
 */
export async function resolveDoctorFee(
  tx: TenantTx,
  tenantId: string,
  doctorProfileId: string,
  visitType: VisitType,
  at: Date,
): Promise<{ fee: DoctorFee | null; followsBase: boolean }> {
  const latest = (type: VisitType) =>
    tx.doctorFee.findFirst({
      where: { tenantId, doctorProfileId, visitType: type, effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
    });
  const own = await latest(visitType);
  if (own || visitType === 'NEW') {
    return { fee: own, followsBase: false };
  }
  return { fee: await latest('NEW'), followsBase: true };
}
