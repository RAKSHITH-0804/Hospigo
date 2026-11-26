import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '../../generated/prisma';
import type { LibrarySetup } from './showcase-library';

type Tokens = {
  signHospitalAccess: (c: { tenantId: string; userId: string; branchId: string }) => string;
};
type ApprovalSetup = LibrarySetup & { admin: { id: string }; receptionists: Array<{ id: string }> };

/**
 * A believable mix of money-back and cancellation requests, made through the real routes: some
 * approved (partly), some rejected, some still waiting, so the approvals badge, the Refund requests
 * tab and the dashboards show real content. Runs once per hospital (skipped when requests exist).
 */
export async function seedApprovals(
  app: INestApplication,
  tokens: Tokens,
  prisma: PrismaClient,
  setups: ApprovalSetup[],
): Promise<void> {
  for (const s of setups) {
    if ((await prisma.refundRequest.count({ where: { tenantId: s.tenantId } })) >= 10) {
      continue;
    }
    const token = (id: string) =>
      tokens.signHospitalAccess({ tenantId: s.tenantId, userId: id, branchId: s.mainBranchId });
    const recv = token(s.receptionists[0]!.id);
    const admin = token(s.admin.id);
    const call = (method: 'post', path: string, bearer: string, body: object) =>
      request(app.getHttpServer())
        [method](path)
        .set('Authorization', `Bearer ${bearer}`)
        .send(body);
    const failures: string[] = [];
    const log = (what: string, res: { status: number; text: string }): boolean => {
      if (res.status === 200 || res.status === 201) {
        return true;
      }
      failures.push(`${what}: ${res.status} ${res.text.slice(0, 120)}`);
      return false;
    };
    // fresh paid, waiting visits through the real reception route: money-back and cancellation requests
    // are only possible before the consultation starts
    const patients = await prisma.patient.findMany({
      where: { tenantId: s.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: { id: true },
    });
    const doctors = await prisma.doctorProfile.findMany({
      where: { tenantId: s.tenantId },
      take: 4,
      select: { id: true },
    });
    const made: Array<{ visitId: string; billId: string }> = [];
    for (const [i, patient] of patients.entries()) {
      const res = await call('post', '/opd/visits', recv, {
        patientId: patient.id,
        doctorProfileId: doctors[i % doctors.length]!.id,
        visitType: 'NEW',
        idempotencyKey: `SHOWAP-${s.hospital.code}-V-${i}`,
      });
      if (log('new visit', res)) {
        made.push({ visitId: res.body.id as string, billId: res.body.bill.id as string });
      }
    }
    const bills = made.slice(0, 11).map((m) => ({ id: m.billId }));
    const open = made.slice(11, 15).map((m) => ({ id: m.visitId }));
    let n = 0;
    const key = (kind: string) => `SHOWAP-${s.hospital.code}-${kind}-${(n += 1)}`;
    // decide: 4 approved, 3 rejected, 4 waiting
    for (const [index, bill] of bills.slice(0, 11).entries()) {
      const asked = await call('post', `/opd/bills/${bill.id}/refund-requests`, recv, {
        amountPaise: 5_000 + (index % 3) * 2_500,
        reason: ['Charged for a service not taken', 'Wrong item billed', 'Duplicate entry'][
          index % 3
        ],
        idempotencyKey: key('RF'),
      });
      if (!log('refund request', asked)) {
        continue;
      }
      const id = asked.body.request.id as string;
      if (index < 4) {
        log('approve', await call('post', `/opd/refund-requests/${id}/approve`, admin, {}));
      } else if (index < 7) {
        log(
          'reject',
          await call('post', `/opd/refund-requests/${id}/reject`, admin, { note: 'Not valid' }),
        );
      }
    }
    // cancellations of visits that are still waiting: one approved, one rejected, the rest waiting
    for (const [index, visit] of open.entries()) {
      const asked = await call('post', `/opd/visits/${visit.id}/cancel-requests`, recv, {
        reason: 'Patient left before the consultation',
        idempotencyKey: key('CX'),
      });
      if (!log('cancel request', asked)) {
        continue;
      }
      const id = asked.body.request.id as string;
      if (index === 0) {
        log('approve cancel', await call('post', `/opd/refund-requests/${id}/approve`, admin, {}));
      } else if (index === 1) {
        log(
          'reject cancel',
          await call('post', `/opd/refund-requests/${id}/reject`, admin, {
            note: 'Patient is waiting',
          }),
        );
      }
    }
    console.log(`${s.hospital.name}: requests made, ${failures.length} refused.`);
    for (const f of failures.slice(0, 3)) {
      console.log('  ' + f);
    }
  }
}
