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
    if ((await prisma.refundRequest.count({ where: { tenantId: s.tenantId } })) > 0) {
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
    const log = (what: string, status: number) => {
      if (status !== 200 && status !== 201) {
        throw new Error(`Approvals seed: ${what} failed with ${status}`);
      }
    };
    const bills = await prisma.bill.findMany({
      where: {
        tenantId: s.tenantId,
        branchId: s.mainBranchId,
        totalPaise: { gte: 20_000 },
        visit: { status: 'COMPLETED' },
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { id: true },
    });
    const open = await prisma.opdVisit.findMany({
      where: { tenantId: s.tenantId, branchId: s.mainBranchId, status: 'WAITING' },
      orderBy: { createdAt: 'desc' },
      take: 4,
      select: { id: true },
    });
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
      log('refund request', asked.status);
      const id = asked.body.request.id as string;
      if (index < 4) {
        log(
          'approve',
          (await call('post', `/opd/refund-requests/${id}/approve`, admin, {})).status,
        );
      } else if (index < 7) {
        log(
          'reject',
          (await call('post', `/opd/refund-requests/${id}/reject`, admin, { note: 'Not valid' }))
            .status,
        );
      }
    }
    // cancellations of visits that are still waiting: one approved, one rejected, the rest waiting
    for (const [index, visit] of open.entries()) {
      const asked = await call('post', `/opd/visits/${visit.id}/cancel-requests`, recv, {
        reason: 'Patient left before the consultation',
        idempotencyKey: key('CX'),
      });
      log('cancel request', asked.status);
      const id = asked.body.request.id as string;
      if (index === 0) {
        log(
          'approve cancel',
          (await call('post', `/opd/refund-requests/${id}/approve`, admin, {})).status,
        );
      } else if (index === 1) {
        log(
          'reject cancel',
          (
            await call('post', `/opd/refund-requests/${id}/reject`, admin, {
              note: 'Patient is waiting',
            })
          ).status,
        );
      }
    }
  }
}
