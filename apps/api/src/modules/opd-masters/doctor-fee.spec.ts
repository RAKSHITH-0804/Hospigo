import type { DoctorFee, VisitType } from '../../generated/prisma';
import type { TenantTx } from '../../database/tenant-db';
import { pickDoctorFee, resolveDoctorFee } from './doctor-fee';

const fee = (
  visitType: VisitType,
  amountPaise: number,
  from: string,
  branchId: string | null = null,
): DoctorFee =>
  ({
    id: `${visitType}-${from}-${branchId ?? 'all'}`,
    branchId,
    visitType,
    amountPaise,
    effectiveFrom: new Date(from),
  }) as unknown as DoctorFee;

/** A stand-in for the transaction: answers like the database would for the rows given. */
function txWith(rows: DoctorFee[]): TenantTx {
  return {
    doctorFee: {
      // the rows that have started (the lookup picks the right one itself)
      findMany: async ({ where }: { where: { effectiveFrom: { lte: Date } } }) =>
        rows.filter((r) => r.effectiveFrom <= where.effectiveFrom.lte),
      findFirst: async ({
        where,
      }: {
        where: { visitType: VisitType; effectiveFrom: { lte: Date } };
      }) =>
        rows
          .filter(
            (r) => r.visitType === where.visitType && r.effectiveFrom <= where.effectiveFrom.lte,
          )
          .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null,
    },
  } as unknown as TenantTx;
}

const NOW = new Date('2026-11-24T10:00:00Z');

describe('resolveDoctorFee', () => {
  it('the new-visit fee is the latest NEW row that has started', async () => {
    const tx = txWith([
      fee('NEW', 100, '2026-01-01T00:00:00Z'),
      fee('NEW', 200, '2026-11-01T00:00:00Z'),
      fee('NEW', 300, '2026-12-01T00:00:00Z'), // not started
    ]);
    const r = await resolveDoctorFee(tx, 't', 'd', 'NEW', NOW);
    expect(r.fee?.amountPaise).toBe(200);
    expect(r.followsBase).toBe(false);
  });

  it('a follow-up with no follow-up fee costs the new-visit fee', async () => {
    const tx = txWith([fee('NEW', 200, '2026-11-01T00:00:00Z')]);
    const r = await resolveDoctorFee(tx, 't', 'd', 'FOLLOW_UP', NOW);
    expect(r.fee?.amountPaise).toBe(200);
    expect(r.followsBase).toBe(true);
  });

  it('a separate follow-up fee wins, and a later new-visit fee does not change it', async () => {
    const tx = txWith([
      fee('NEW', 200, '2026-11-01T00:00:00Z'),
      fee('FOLLOW_UP', 120, '2026-11-02T00:00:00Z'),
      fee('NEW', 900, '2026-11-20T00:00:00Z'),
    ]);
    const r = await resolveDoctorFee(tx, 't', 'd', 'FOLLOW_UP', NOW);
    expect(r.fee?.amountPaise).toBe(120);
    expect(r.followsBase).toBe(false);
  });

  it('a follow-up fee that has not started yet is not used: the new-visit fee is', async () => {
    const tx = txWith([
      fee('NEW', 200, '2026-11-01T00:00:00Z'),
      fee('FOLLOW_UP', 120, '2026-12-01T00:00:00Z'),
    ]);
    const r = await resolveDoctorFee(tx, 't', 'd', 'FOLLOW_UP', NOW);
    expect(r.fee?.amountPaise).toBe(200);
    expect(r.followsBase).toBe(true);
  });

  it('no fee at all gives nothing (the visit is then refused as not configured)', async () => {
    const tx = txWith([]);
    expect((await resolveDoctorFee(tx, 't', 'd', 'NEW', NOW)).fee).toBeNull();
    expect((await resolveDoctorFee(tx, 't', 'd', 'FOLLOW_UP', NOW)).fee).toBeNull();
  });
});

describe('pickDoctorFee (per-branch fees, Step 9)', () => {
  const rows = [
    fee('NEW', 500, '2026-01-01T00:00:00Z'),
    fee('FOLLOW_UP', 300, '2026-01-01T00:00:00Z'),
    fee('NEW', 700, '2026-02-01T00:00:00Z', 'east'),
  ];

  it('a branch fee beats the hospital-wide fee in its branch only', () => {
    expect(pickDoctorFee(rows, 'NEW', 'east', NOW).fee?.amountPaise).toBe(700);
    expect(pickDoctorFee(rows, 'NEW', 'main', NOW).fee?.amountPaise).toBe(500);
    expect(pickDoctorFee(rows, 'NEW', null, NOW).fee?.amountPaise).toBe(500);
  });

  it('a branch fee wins even when the hospital-wide fee is newer', () => {
    const all = [...rows, fee('NEW', 900, '2026-11-01T00:00:00Z')];
    expect(pickDoctorFee(all, 'NEW', 'east', NOW).fee?.amountPaise).toBe(700);
    expect(pickDoctorFee(all, 'NEW', 'main', NOW).fee?.amountPaise).toBe(900);
  });

  it('a branch fee that has not started is ignored', () => {
    const all = [...rows, fee('NEW', 800, '2026-12-01T00:00:00Z', 'east')];
    expect(pickDoctorFee(all, 'NEW', 'east', NOW).fee?.amountPaise).toBe(700);
  });

  it('a follow-up uses its own fee (branch, then hospital-wide), else the new-visit fee found the same way', () => {
    expect(pickDoctorFee(rows, 'FOLLOW_UP', 'east', NOW)).toMatchObject({
      followsBase: false,
      fee: { amountPaise: 300 },
    });
    const noFollowUp = [rows[0]!, rows[2]!];
    expect(pickDoctorFee(noFollowUp, 'FOLLOW_UP', 'east', NOW)).toMatchObject({
      followsBase: true,
      fee: { amountPaise: 700 },
    });
    expect(pickDoctorFee(noFollowUp, 'FOLLOW_UP', 'main', NOW).fee?.amountPaise).toBe(500);
    expect(pickDoctorFee([], 'NEW', 'east', NOW).fee).toBeNull();
  });
});
