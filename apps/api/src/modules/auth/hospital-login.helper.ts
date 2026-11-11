import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BranchAccessLookup } from '../../database/branch-access.lookup';
import { runWithContext } from '../../common/request-context';
import { TenantDb } from '../../database/tenant-db';
import { MembershipHelper } from './membership.helper';
import { PasswordService } from './password.service';

/** Uniform internal failure — mapped to one generic client error. */
export type HospitalLoginFailure = {
  ok: false;
  reason: 'AUTH_FAILED';
  /** Present when the access code resolved (for lockout audit only). */
  tenantId?: string;
  branchId?: string;
  userId?: string;
};

export type HospitalLoginSuccess = {
  ok: true;
  tenantId: string;
  branchId: string;
  isMain: boolean;
  userId: string;
  email: string;
  displayName: string;
  mustChangePassword: boolean;
};

export type HospitalLoginResult = HospitalLoginSuccess | HospitalLoginFailure;

function failKnown(branch: {
  tenantId: string;
  branchId: string;
  userId?: string;
}): HospitalLoginFailure {
  return {
    ok: false,
    reason: 'AUTH_FAILED',
    tenantId: branch.tenantId,
    branchId: branch.branchId,
    userId: branch.userId,
  };
}

/**
 * Login-time resolution.
 * Unknown code, unknown email, wrong password, disabled user, inactive branch/hospital,
 * and missing membership all return the same AUTH_FAILED result.
 * Dummy argon2 verify runs on failure paths that did not check a real hash.
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
      await this.passwords.burnVerifyTime();
      return { ok: false, reason: 'AUTH_FAILED' };
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
          await this.passwords.burnVerifyTime();
          return failKnown({
            tenantId: branch.tenantId,
            branchId: branch.branchId,
            userId: user?.id,
          });
        }

        const passwordOk = await this.passwords.verify(user.passwordHash, input.password);
        if (!passwordOk) {
          return failKnown({
            tenantId: branch.tenantId,
            branchId: branch.branchId,
            userId: user.id,
          });
        }

        const member = await this.membership.hasActiveBranchMembership(user.id, branch.branchId);
        if (!member) {
          return failKnown({
            tenantId: branch.tenantId,
            branchId: branch.branchId,
            userId: user.id,
          });
        }

        return {
          ok: true,
          tenantId: branch.tenantId,
          branchId: branch.branchId,
          isMain: branch.isMain,
          userId: user.id,
          email: user.email,
          displayName: user.displayName,
          mustChangePassword: user.mustChangePassword,
        };
      },
    );
  }
}
