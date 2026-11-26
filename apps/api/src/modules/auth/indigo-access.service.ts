import type { AccessClaims } from './token.types';
import { randomUUID } from 'node:crypto';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { runWithContext } from '../../common/request-context';
import { HqPrismaService } from '../../database/hq-prisma.service';
import { TenantDb } from '../../database/tenant-db';
import { AuthRedisService } from './auth-redis.service';
import { AuthService, type TokenPairResponse } from './auth.service';
import { IndigoCheckService } from './indigo-check.service';

/** One answer for every reason an Indigo person cannot enter a hospital (no hint which one). */
export const INDIGO_HOSPITAL_UNAVAILABLE = 'Hospital not available';

const ROLE_BY_INDIGO_ROLE = { OWNER: 'TENANT_ADMIN', EMPLOYEE: 'INDIGO_EMPLOYEE' } as const;

export type IndigoHospital = { id: string; code: string; name: string };

/**
 * Step 2.1b: an Indigo person (a valid HQ token) enters one hospital. Inside the hospital they are a
 * hidden user row that only this service creates (the database refuses the flag from anywhere
 * else); they get an ordinary hospital token and refresh session, so row level security and every
 * permission check apply exactly as for staff. Nothing about being from Indigo is a claim in the
 * token, so nothing can be forged. Each entry is written to the append-only access log.
 */
@Injectable()
export class IndigoAccessService {
  constructor(
    private readonly hq: HqPrismaService,
    private readonly tenantDb: TenantDb,
    private readonly check: IndigoCheckService,
    private readonly redis: AuthRedisService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Who the caller is for the Indigo entry: an Indigo (HQ) token is the person itself; a HOSPITAL token
   * counts only when its user is the hidden user of an Indigo person (that is how an Indigo person already
   * inside a hospital switches to another one). Anyone else: null, answered like every other refusal.
   */
  async personOf(auth: AccessClaims): Promise<string | null> {
    if (auth.tokenType === 'HQ') {
      return auth.userId;
    }
    if (auth.tokenType !== 'HOSPITAL') {
      return null;
    }
    const user = await this.tenantDb.withTenant((tx) =>
      tx.user.findFirst({ where: { id: auth.userId }, select: { indigoHqUserId: true } }),
    );
    return user?.indigoHqUserId ?? null;
  }

  /** The hospitals this person may enter now (an Owner: all active ones; an Employee: the assigned ones). */
  async hospitals(hqUserId: string): Promise<IndigoHospital[]> {
    const person = await this.hq.hqUser.findUnique({
      where: { id: hqUserId },
      select: { isActive: true, indigoRole: true },
    });
    if (!person?.isActive) {
      return [];
    }
    let assignedIds: string[] | null = null;
    if (person.indigoRole === 'EMPLOYEE') {
      const rows = await this.hq.hqUserHospital.findMany({
        where: { hqUserId },
        select: { tenantId: true },
      });
      assignedIds = rows.map((row) => row.tenantId);
    } else if (person.indigoRole !== 'OWNER') {
      return [];
    }
    return this.hq.hospital.findMany({
      where: {
        isActive: true,
        status: 'ACTIVE',
        ...(assignedIds ? { id: { in: assignedIds } } : {}),
      },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async enter(
    hqUserId: string,
    hospitalId: string,
    meta: { ip: string; userAgent: string | undefined },
  ): Promise<TokenPairResponse> {
    await this.redis.assertIpAllowed(meta.ip);
    if (!(await this.check.allowed(hqUserId, hospitalId))) {
      throw new ForbiddenException(INDIGO_HOSPITAL_UNAVAILABLE);
    }
    const person = await this.hq.hqUser.findUniqueOrThrow({
      where: { id: hqUserId },
      select: { displayName: true, indigoRole: true },
    });
    const main = await this.hq.branch.findFirst({
      where: { tenantId: hospitalId, isActive: true },
      orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
      select: { id: true },
    });
    if (!main) {
      throw new ForbiddenException(INDIGO_HOSPITAL_UNAVAILABLE);
    }
    const roleCode = ROLE_BY_INDIGO_ROLE[person.indigoRole as 'OWNER' | 'EMPLOYEE'];
    const shownName = `${person.displayName} (Indigo)`;

    return runWithContext(
      {
        tenantId: hospitalId,
        userId: null,
        kind: 'HOSPITAL',
        activeBranchId: main.id,
        requestId: randomUUID(),
      },
      async () => {
        // the only place that may set the Indigo flag: the database trigger checks for this word
        const userId = await this.tenantDb.withTenant(
          async (tx) => {
            const role = await tx.role.findFirst({ where: { code: roleCode } });
            if (!role) {
              return null;
            }
            let user = await tx.user.findFirst({ where: { indigoHqUserId: hqUserId } });
            if (!user) {
              user = await tx.user.create({
                data: {
                  tenantId: hospitalId,
                  code: `INDIGO-${hqUserId.slice(-8)}`,
                  email: `indigo-${hqUserId}@indigo.invalid`,
                  displayName: shownName,
                  // never a valid hash: nobody can sign in to this user with a password
                  passwordHash: '!',
                  mustChangePassword: false,
                  passwordChangedAt: new Date(),
                  indigoHqUserId: hqUserId,
                },
              });
            } else if (!user.isActive || user.displayName !== shownName) {
              await tx.user.update({
                where: { id: user.id },
                data: { isActive: true, displayName: shownName },
              });
            }
            // exactly one live assignment: the role that matches the Indigo role TODAY
            await tx.roleAssignment.updateMany({
              where: { userId: user.id, isActive: true, NOT: { roleId: role.id } },
              data: { isActive: false },
            });
            const assignment = await tx.roleAssignment.findFirst({
              where: { userId: user.id, roleId: role.id, scopeType: 'HOSPITAL' },
            });
            if (!assignment) {
              await tx.roleAssignment.create({
                data: {
                  tenantId: hospitalId,
                  userId: user.id,
                  roleId: role.id,
                  scopeType: 'HOSPITAL',
                },
              });
            } else if (!assignment.isActive) {
              await tx.roleAssignment.update({
                where: { id: assignment.id },
                data: { isActive: true },
              });
            }
            const branches = await tx.branch.findMany({
              where: { isActive: true },
              select: { id: true },
            });
            for (const branch of branches) {
              await tx.userBranch.upsert({
                where: {
                  tenantId_userId_branchId: {
                    tenantId: hospitalId,
                    userId: user.id,
                    branchId: branch.id,
                  },
                },
                create: { tenantId: hospitalId, userId: user.id, branchId: branch.id },
                update: { isActive: true },
              });
            }
            await tx.indigoAccessLog.create({
              data: { tenantId: hospitalId, hqUserId, userId: user.id, action: 'ENTER' },
            });
            return user.id;
          },
          { indigoEnter: true },
        );
        if (!userId) {
          throw new ForbiddenException(INDIGO_HOSPITAL_UNAVAILABLE);
        }
        return this.auth.createHospitalSessionFor({
          tenantId: hospitalId,
          userId,
          branchId: main.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      },
    );
  }
}
