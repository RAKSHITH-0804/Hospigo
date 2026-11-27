import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { ApiEnv } from '../../config/env';
import { runWithContext } from '../../common/request-context';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import type { AuthConfig } from './auth.config';
import { AuthRedisService } from './auth-redis.service';
import { authFailed } from './auth.errors';
import { canSwitchBranches, switchableBranchIds } from './hospital-scope';
import { TokenService } from './token.service';
import type { HospitalAccessClaims } from './token.types';
import type { TokenPairResponse } from './auth.service';

export type SwitchableBranch = {
  id: string;
  name: string;
  isMain: boolean;
  isCurrent: boolean;
};

/** One body for every "you may not use that branch" reason (no existence leak). */
export const BRANCH_NOT_AVAILABLE_MESSAGE = 'Branch not available';
export const NOT_A_SWITCHER_MESSAGE = 'Branch switching is not allowed';

type DeniedReason = 'NOT_SWITCHER' | 'BRANCH_NOT_AVAILABLE' | 'SAME_BRANCH';

type Outcome =
  | { type: 'ok'; refreshToken: string; branchId: string; mustChangePassword: boolean }
  | { type: 'fail' }
  | { type: 'reuse'; userId: string; branchId: string }
  | { type: 'denied'; reason: DeniedReason };

/**
 * SuperAdmin branch switcher (Step 3d).
 *
 * A switch is a refresh-token ROTATION that also changes the branch:
 * the presented session is revoked and a new session (same family, new branch)
 * replaces it, so reuse detection works exactly as for /auth/refresh.
 * The new access token carries the target branch; permissions and branch
 * modules are recomputed per request from that claim (AccessService).
 *
 * The old access token cannot be revoked (stateless JWT, no session id). It stays
 * valid for at most its remaining lifetime and only for the previous branch,
 * which the same user is entitled to anyway.
 */
@Injectable()
export class BranchSwitchService {
  private readonly auth: AuthConfig;

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly tokens: TokenService,
    private readonly redis: AuthRedisService,
    config: ConfigService<ApiEnv, true>,
  ) {
    this.auth = config.getOrThrow('auth', { infer: true });
  }

  async listSwitchable(claims: HospitalAccessClaims): Promise<SwitchableBranch[]> {
    return this.inContext(claims, async () => {
      const result = await this.tenantDb.withTenant(async (tx) => {
        const user = await tx.user.findFirst({ where: { id: claims.userId } });
        const hospital = await tx.hospital.findFirst({ where: { id: claims.tenantId } });
        const allowed =
          !!user?.isActive &&
          !!hospital &&
          hospital.isActive &&
          hospital.status === 'ACTIVE' &&
          (await canSwitchBranches(tx, claims.userId));
        if (!allowed) {
          return null;
        }
        const scope = await switchableBranchIds(tx, claims.userId);
        return tx.branch.findMany({
          where: { isActive: true, ...(scope.all ? {} : { id: { in: scope.ids } }) },
          select: { id: true, name: true, isMain: true },
          orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
        });
      });
      if (!result) {
        throw new ForbiddenException(NOT_A_SWITCHER_MESSAGE);
      }
      return result.map((b) => ({ ...b, isCurrent: b.id === claims.branchId }));
    });
  }

  async switchBranch(
    claims: HospitalAccessClaims,
    input: { branchId: string; refreshToken: string },
    meta: { ip: string; userAgent: string | undefined },
  ): Promise<TokenPairResponse> {
    await this.redis.assertIpAllowed(meta.ip);

    const parts = this.tokens.parseRefreshToken(input.refreshToken);
    if (!parts || parts.kind !== 'hospital' || parts.tenantId !== claims.tenantId) {
      authFailed();
    }

    return this.inContext(claims, async () => {
      const outcome = await this.tenantDb.withTenant((tx) =>
        this.rotate(tx, claims, parts, input.branchId, meta),
      );

      if (outcome.type === 'reuse') {
        await this.audit('AUTH_REFRESH_REUSE', claims, outcome.branchId, {});
        authFailed();
      }
      if (outcome.type === 'denied') {
        // Denied attempts are audited with a reason code only (never the supplied id).
        await this.audit('AUTH_BRANCH_SWITCH_DENIED', claims, claims.branchId, {
          reason: outcome.reason,
        });
        if (outcome.reason === 'NOT_SWITCHER') {
          throw new ForbiddenException(NOT_A_SWITCHER_MESSAGE);
        }
        if (outcome.reason === 'SAME_BRANCH') {
          throw new BadRequestException('Branch is already active');
        }
        throw new NotFoundException(BRANCH_NOT_AVAILABLE_MESSAGE);
      }
      if (outcome.type !== 'ok') {
        authFailed();
      }

      const accessToken = this.tokens.signHospitalAccess({
        tenantId: claims.tenantId,
        userId: claims.userId,
        branchId: outcome.branchId,
      });
      return {
        accessToken,
        refreshToken: outcome.refreshToken,
        expiresIn: this.tokens.accessExpiresInSec('HOSPITAL'),
        mustChangePassword: outcome.mustChangePassword,
      };
    });
  }

  /** Runs inside ONE tenant transaction. Side effects commit only on type 'ok' or an audited outcome. */
  private async rotate(
    tx: TenantTx,
    claims: HospitalAccessClaims,
    parts: { sessionId: string; secret: string },
    targetBranchId: string,
    meta: { ip: string; userAgent: string | undefined },
  ): Promise<Outcome> {
    const user = await tx.user.findFirst({ where: { id: claims.userId } });
    const hospital = await tx.hospital.findFirst({ where: { id: claims.tenantId } });
    if (!user?.isActive || !hospital || !hospital.isActive || hospital.status !== 'ACTIVE') {
      return { type: 'fail' };
    }

    // 1. Who may switch (re-read from the database on every call, never from the token).
    if (!(await canSwitchBranches(tx, user.id))) {
      return { type: 'denied', reason: 'NOT_SWITCHER' };
    }
    const scope = await switchableBranchIds(tx, user.id);

    // 2. The refresh session must be this user's own, live, and the secret must match.
    const session = await tx.authSession.findFirst({ where: { id: parts.sessionId } });
    if (
      !session ||
      session.userId !== user.id ||
      !this.tokens.verifyRefreshSecret(parts.secret, session.tokenHash)
    ) {
      return { type: 'fail' };
    }
    if (session.revokedAt || session.replacedById) {
      await tx.authSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { type: 'reuse', userId: user.id, branchId: session.branchId };
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return { type: 'fail' };
    }

    // 3. The target: same hospital (RLS), active. One answer for every other case.
    const target = await tx.branch.findFirst({
      where: {
        id: targetBranchId,
        isActive: true,
        // a person with branches of their own can only go to those (one answer for every other case)
        ...(scope.all
          ? {}
          : { id: { in: scope.ids.includes(targetBranchId) ? [targetBranchId] : [] } }),
      },
    });
    if (!target) {
      return { type: 'denied', reason: 'BRANCH_NOT_AVAILABLE' };
    }
    if (target.id === session.branchId) {
      return { type: 'denied', reason: 'SAME_BRANCH' };
    }

    // 4. Atomically take the session. A concurrent rotation that got there first leaves
    //    count 0 here, which is treated as reuse (family revoked) - never two live sessions.
    const claimed = await tx.authSession.updateMany({
      where: { id: session.id, revokedAt: null, replacedById: null },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });
    if (claimed.count !== 1) {
      await tx.authSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { type: 'reuse', userId: user.id, branchId: session.branchId };
    }

    const newSession = await tx.authSession.create({
      data: {
        tenantId: claims.tenantId,
        userId: user.id,
        branchId: target.id,
        tokenHash: 'pending',
        familyId: session.familyId,
        expiresAt: new Date(Date.now() + this.auth.refreshTokenTtlSec * 1000),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    const issued = this.tokens.issueRefreshToken({
      kind: 'hospital',
      tenantId: claims.tenantId,
      sessionId: newSession.id,
    });
    await tx.authSession.update({
      where: { id: newSession.id },
      data: { tokenHash: issued.tokenHash },
    });
    await tx.authSession.update({
      where: { id: session.id },
      data: { replacedById: newSession.id },
    });

    // Audit in the same transaction: no switch without its audit row.
    await tx.auditLog.create({
      data: {
        tenantId: claims.tenantId,
        actorUserId: user.id,
        branchId: target.id,
        action: 'AUTH_BRANCH_SWITCH',
        entityType: 'auth',
        entityId: user.id,
        metadata: {
          requestId: randomUUID(),
          fromBranchId: session.branchId,
          toBranchId: target.id,
          sessionId: newSession.id,
        },
      },
    });

    return {
      type: 'ok',
      refreshToken: issued.raw,
      branchId: target.id,
      mustChangePassword: user.mustChangePassword,
    };
  }

  private async audit(
    action: string,
    claims: HospitalAccessClaims,
    branchId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.tenantDb.withTenant((tx) =>
      tx.auditLog.create({
        data: {
          tenantId: claims.tenantId,
          actorUserId: claims.userId,
          branchId,
          action,
          entityType: 'auth',
          entityId: claims.userId,
          metadata: { requestId: randomUUID(), ...metadata },
        },
      }),
    );
  }

  private inContext<T>(claims: HospitalAccessClaims, fn: () => Promise<T>): Promise<T> {
    return runWithContext(
      {
        tenantId: claims.tenantId,
        userId: claims.userId,
        kind: 'HOSPITAL',
        activeBranchId: claims.branchId,
        requestId: randomUUID(),
      },
      fn,
    );
  }
}
