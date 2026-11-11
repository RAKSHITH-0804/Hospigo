import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BranchAccessLookup } from '../../database/branch-access.lookup';
import { runWithContext } from '../../common/request-context';
import { TenantDb } from '../../database/tenant-db';
import { MembershipHelper } from './membership.helper';
import { PasswordService } from './password.service';

/** Uniform internal failure — 6a-2 maps this to one generic client error. */
export type HospitalLoginFailure = { ok: false; reason: 'AUTH_FAILED' };

export type HospitalLoginSuccess = {
  ok: true;
  tenantId: string;
  branchId: string;
  isMain: boolean;
  userId: string;
  email: string;
  mustChangePassword: boolean;
};

export type HospitalLoginResult = HospitalLoginSuccess | HospitalLoginFailure;

const FAIL: HospitalLoginFailure = { ok: false, reason: 'AUTH_FAILED' };

/**
 * Login-time resolution (no HTTP endpoint yet).
 * Unknown code, unknown email, wrong password, disabled user, inactive branch/hospital,
 * and missing membership all return the same AUTH_FAILED result.
 */
@Injectable()
export class HospitalLoginHelper {
  constructor(
    private readonly branchLookup: BranchAccessLookup,
    private readonly tenantDb: TenantDb,
    private readonly membership: MembershipHelper,
    private readonly passwords: PasswordService,
  ) {}

  async attempt(input: {
    accessCode: string;
    email: string;
    password: string;
  }): Promise<HospitalLoginResult> {
    const branch = await this.branchLookup.findByAccessCode(input.accessCode);
    if (!branch) {
      return FAIL;
    }

    return runWithContext(
      {
        tenantId: branch.tenantId,
        userId: null,
        kind: 'HOSPITAL',
        activeBranchId: branch.branchId,
        requestId: randomUUID(),
      },
      async () => {
        const email = input.email.trim().toLowerCase();
        const user = await this.tenantDb.withTenant((tx) =>
          tx.user.findFirst({
            where: { email: { equals: email, mode: 'insensitive' } },
          }),
        );
        if (!user || !user.isActive) {
          return FAIL;
        }

        const passwordOk = await this.passwords.verify(user.passwordHash, input.password);
        if (!passwordOk) {
          return FAIL;
        }

        const member = await this.membership.hasActiveBranchMembership(user.id, branch.branchId);
        if (!member) {
          return FAIL;
        }

        return {
          ok: true,
          tenantId: branch.tenantId,
          branchId: branch.branchId,
          isMain: branch.isMain,
          userId: user.id,
          email: user.email,
          mustChangePassword: user.mustChangePassword,
        };
      },
    );
  }
}
