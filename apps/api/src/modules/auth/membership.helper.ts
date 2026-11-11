import { Injectable } from '@nestjs/common';
import { TenantDb } from '../../database/tenant-db';

/**
 * Login membership: user may use a branch access code only when UserBranch is active
 * for that branch. HOSPITAL-scoped SuperAdmin logs in via the Main Branch code
 * (seeds attach SuperAdmin to MAIN).
 */
@Injectable()
export class MembershipHelper {
  constructor(private readonly tenantDb: TenantDb) {}

  async hasActiveBranchMembership(userId: string, branchId: string): Promise<boolean> {
    const row = await this.tenantDb.withTenant((tx) =>
      tx.userBranch.findFirst({
        where: { userId, branchId, isActive: true },
        select: { id: true },
      }),
    );
    return row !== null;
  }
}
