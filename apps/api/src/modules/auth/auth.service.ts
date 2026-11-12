import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import type { ApiEnv } from '../../config/env';
import { getContext, requireContext, runWithContext } from '../../common/request-context';
import { HqPrismaService } from '../../database/hq-prisma.service';
import { TenantDb } from '../../database/tenant-db';
import type { AuthConfig } from './auth.config';
import { AuthRedisService } from './auth-redis.service';
import { authFailed } from './auth.errors';
import { HospitalLoginHelper } from './hospital-login.helper';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import type { AccessClaims, HospitalAccessClaims } from './token.types';
import { isHospitalTokenType } from './token.types';

export type TokenPairResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  mustChangePassword: boolean;
};

export type AuthMeBranch = {
  id: string;
  name: string;
  isMain: boolean;
};

export type AuthMeModule = {
  code: string;
  name: string;
};

export type AuthMeResponse = {
  id: string;
  displayName: string;
  email: string;
  kind: 'HOSPITAL' | 'HQ';
  hospitalName: string | null;
  activeBranchId: string | null;
  activeBranchName: string | null;
  roleCodes: string[];
  mustChangePassword: boolean;
  /** Hospital only: branches with an active membership. Empty for HQ. */
  branches: AuthMeBranch[];
  /**
   * Hospital only: modules enabled for the active branch
   * (subscription + branch_modules flags, same rules as AccessService).
   * Empty for HQ.
   */
  enabledModules: AuthMeModule[];
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly auth: AuthConfig;

  constructor(
    private readonly hospitalLoginHelper: HospitalLoginHelper,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly tenantDb: TenantDb,
    private readonly hqPrisma: HqPrismaService,
    private readonly redis: AuthRedisService,
    config: ConfigService<ApiEnv, true>,
  ) {
    this.auth = config.getOrThrow('auth', { infer: true });
  }

  async hospitalLogin(
    input: { accessCode: string; email: string; password: string },
    meta: { ip: string; userAgent: string | undefined },
  ): Promise<TokenPairResponse> {
    await this.redis.assertIpAllowed(meta.ip);
    const accountHash = this.redis.accountKeyMaterial(input.accessCode, input.email);
    if (await this.redis.isAccountLocked(accountHash)) {
      await this.passwords.burnVerifyTime();
      authFailed();
    }

    const result = await this.hospitalLoginHelper.attempt(input);
    if (!result.ok) {
      const { locked } = await this.redis.recordFailure(accountHash);
      if (locked) {
        if (result.tenantId && result.branchId) {
          await runWithContext(
            {
              tenantId: result.tenantId,
              userId: result.userId ?? null,
              kind: 'HOSPITAL',
              activeBranchId: result.branchId,
              requestId: randomUUID(),
            },
            async () => {
              await this.auditHospital('AUTH_LOCKOUT', {
                userId: result.userId,
                branchId: result.branchId!,
              });
            },
          );
        } else {
          this.logger.warn(
            `Hospital login lockout triggered accountHash=${accountHash.slice(0, 12)}`,
          );
        }
      }
      authFailed();
    }

    await this.redis.clearFailures(accountHash);

    return runWithContext(
      {
        tenantId: result.tenantId,
        userId: result.userId,
        kind: 'HOSPITAL',
        activeBranchId: result.branchId,
        requestId: randomUUID(),
      },
      async () => {
        await this.tenantDb.withTenant((tx) =>
          tx.user.update({
            where: { id: result.userId },
            data: { lastLoginAt: new Date() },
          }),
        );

        if (result.mustChangePassword) {
          const accessToken = this.tokens.signHospitalAccess({
            tenantId: result.tenantId,
            userId: result.userId,
            branchId: result.branchId,
            tokenType: 'CHANGE_PASSWORD_HOSPITAL',
          });
          await this.auditHospital('AUTH_LOGIN_SUCCESS', {
            userId: result.userId,
            branchId: result.branchId,
            metadata: { mustChangePassword: true },
          });
          return {
            accessToken,
            expiresIn: this.tokens.accessExpiresInSec('CHANGE_PASSWORD_HOSPITAL'),
            mustChangePassword: true,
          };
        }

        const pair = await this.createHospitalSession({
          tenantId: result.tenantId,
          userId: result.userId,
          branchId: result.branchId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        await this.auditHospital('AUTH_LOGIN_SUCCESS', {
          userId: result.userId,
          branchId: result.branchId,
          metadata: { mustChangePassword: false },
        });
        return pair;
      },
    );
  }

  async hqLogin(
    input: { email: string; password: string },
    meta: { ip: string; userAgent: string | undefined },
  ): Promise<TokenPairResponse> {
    await this.redis.assertIpAllowed(meta.ip);
    const accountHash = this.redis.accountKeyMaterial(null, `hq|${input.email}`);
    if (await this.redis.isAccountLocked(accountHash)) {
      await this.passwords.burnVerifyTime();
      this.logger.warn(`HQ login failed (locked) emailHash=${shortEmailHash(input.email)}`);
      authFailed();
    }

    const email = input.email.trim().toLowerCase();
    const user = await this.hqPrisma.hqUser.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      await this.passwords.burnVerifyTime();
      const { locked } = await this.redis.recordFailure(accountHash);
      this.logger.warn(
        `HQ login failed emailHash=${shortEmailHash(email)}${locked ? ' lockout' : ''}`,
      );
      authFailed();
    }

    const ok = await this.passwords.verify(user.passwordHash, input.password);
    if (!ok) {
      const { locked } = await this.redis.recordFailure(accountHash);
      this.logger.warn(
        `HQ login failed emailHash=${shortEmailHash(email)}${locked ? ' lockout' : ''}`,
      );
      authFailed();
    }

    await this.redis.clearFailures(accountHash);
    await this.hqPrisma.hqUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    if (user.mustChangePassword) {
      const accessToken = this.tokens.signHqAccess({
        userId: user.id,
        tokenType: 'CHANGE_PASSWORD_HQ',
      });
      this.logger.log(`HQ login success (must change password) userId=${user.id}`);
      return {
        accessToken,
        expiresIn: this.tokens.accessExpiresInSec('CHANGE_PASSWORD_HQ'),
        mustChangePassword: true,
      };
    }

    const pair = await this.createHqSession({
      userId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    this.logger.log(`HQ login success userId=${user.id}`);
    return pair;
  }

  async refresh(
    refreshToken: string,
    meta: { ip: string; userAgent: string | undefined },
  ): Promise<TokenPairResponse> {
    await this.redis.assertIpAllowed(meta.ip);
    const parts = this.tokens.parseRefreshToken(refreshToken);
    if (!parts) {
      authFailed();
    }

    if (parts.kind === 'hospital') {
      return this.refreshHospital(parts, meta);
    }
    return this.refreshHq(parts, meta);
  }

  /**
   * Logout is @Public and requires a valid refresh token in the body.
   * Safer than requiring a Bearer access token: expired access tokens can still
   * revoke the session; possession of the refresh secret is enough to end it.
   * Idempotent: unknown/already-revoked tokens return success.
   */
  async logout(refreshToken: string): Promise<{ ok: true }> {
    const parts = this.tokens.parseRefreshToken(refreshToken);
    if (!parts) {
      return { ok: true };
    }
    if (parts.kind === 'hospital') {
      await runWithContext(
        {
          tenantId: parts.tenantId,
          userId: null,
          kind: 'HOSPITAL',
          activeBranchId: null,
          requestId: randomUUID(),
        },
        async () => {
          await this.tenantDb.withTenant(async (tx) => {
            const session = await tx.authSession.findFirst({
              where: { id: parts.sessionId },
            });
            if (!session) {
              return;
            }
            if (
              !this.tokens.verifyRefreshSecret(parts.secret, session.tokenHash) ||
              session.revokedAt
            ) {
              return;
            }
            await tx.authSession.update({
              where: { id: session.id },
              data: { revokedAt: new Date() },
            });
          });
        },
      );
      return { ok: true };
    }

    const session = await this.hqPrisma.hqAuthSession.findUnique({
      where: { id: parts.sessionId },
    });
    if (
      session &&
      this.tokens.verifyRefreshSecret(parts.secret, session.tokenHash) &&
      !session.revokedAt
    ) {
      await this.hqPrisma.hqAuthSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
    }
    return { ok: true };
  }

  async changePassword(
    claims: AccessClaims,
    input: { currentPassword: string; newPassword: string },
    meta: { ip: string; userAgent: string | undefined },
  ): Promise<TokenPairResponse> {
    await this.redis.assertIpAllowed(meta.ip);

    const check = this.passwords.validatePlainPassword(input.newPassword);
    if (!check.ok) {
      throw new BadRequestException(`Password rejected: ${check.reason}`);
    }

    if (isHospitalTokenType(claims.tokenType)) {
      const hospitalClaims = claims as HospitalAccessClaims;
      const accountHash = this.redis.changePasswordKeyMaterial(
        'hospital',
        hospitalClaims.tenantId,
        hospitalClaims.userId,
      );
      if (await this.redis.isAccountLocked(accountHash, 'cpw')) {
        await this.passwords.burnVerifyTime();
        authFailed();
      }

      return runWithContext(
        {
          tenantId: hospitalClaims.tenantId,
          userId: hospitalClaims.userId,
          kind: 'HOSPITAL',
          activeBranchId: hospitalClaims.branchId,
          requestId: randomUUID(),
        },
        async () => {
          const user = await this.tenantDb.withTenant((tx) =>
            tx.user.findFirst({ where: { id: hospitalClaims.userId } }),
          );
          if (!user || !user.isActive) {
            authFailed();
          }
          const ok = await this.passwords.verify(user.passwordHash, input.currentPassword);
          if (!ok) {
            const { locked } = await this.redis.recordFailure(accountHash, 'cpw');
            if (locked) {
              await this.auditHospital('AUTH_LOCKOUT', {
                userId: user.id,
                branchId: hospitalClaims.branchId,
                metadata: { source: 'change-password' },
              });
            }
            authFailed();
          }
          await this.redis.clearFailures(accountHash, 'cpw');
          const passwordHash = await this.passwords.hash(input.newPassword);
          await this.tenantDb.withTenant(async (tx) => {
            await tx.user.update({
              where: { id: user.id },
              data: {
                passwordHash,
                mustChangePassword: false,
                passwordChangedAt: new Date(),
              },
            });
            await tx.authSession.updateMany({
              where: { userId: user.id, revokedAt: null },
              data: { revokedAt: new Date() },
            });
          });
          await this.auditHospital('AUTH_PASSWORD_CHANGE', {
            userId: user.id,
            branchId: hospitalClaims.branchId,
          });
          return this.createHospitalSession({
            tenantId: hospitalClaims.tenantId,
            userId: user.id,
            branchId: hospitalClaims.branchId,
            ip: meta.ip,
            userAgent: meta.userAgent,
          });
        },
      );
    }

    const accountHash = this.redis.changePasswordKeyMaterial('hq', null, claims.userId);
    if (await this.redis.isAccountLocked(accountHash, 'cpw')) {
      await this.passwords.burnVerifyTime();
      this.logger.warn(`HQ change-password locked userId=${claims.userId}`);
      authFailed();
    }

    const user = await this.hqPrisma.hqUser.findUnique({ where: { id: claims.userId } });
    if (!user || !user.isActive) {
      authFailed();
    }
    const ok = await this.passwords.verify(user.passwordHash, input.currentPassword);
    if (!ok) {
      const { locked } = await this.redis.recordFailure(accountHash, 'cpw');
      this.logger.warn(`HQ change-password failed userId=${user.id}${locked ? ' lockout' : ''}`);
      authFailed();
    }
    await this.redis.clearFailures(accountHash, 'cpw');
    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.hqPrisma.hqUser.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });
    await this.hqPrisma.hqAuthSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.logger.log(`HQ password change userId=${user.id}`);
    return this.createHqSession({
      userId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  async me(claims: AccessClaims): Promise<AuthMeResponse> {
    if (isHospitalTokenType(claims.tokenType)) {
      const hospitalClaims = claims as HospitalAccessClaims;
      return runWithContext(
        {
          tenantId: hospitalClaims.tenantId,
          userId: hospitalClaims.userId,
          kind: 'HOSPITAL',
          activeBranchId: hospitalClaims.branchId,
          requestId: randomUUID(),
        },
        async () => {
          const data = await this.tenantDb.withTenant(async (tx) => {
            const user = await tx.user.findFirst({
              where: { id: hospitalClaims.userId },
              include: {
                hospital: { select: { name: true } },
                userBranches: {
                  where: { isActive: true },
                  include: {
                    branch: { select: { id: true, name: true, isMain: true, isActive: true } },
                  },
                },
                roleAssignments: {
                  where: { isActive: true },
                  include: { role: { select: { code: true, isActive: true } } },
                },
              },
            });
            if (!user) {
              return null;
            }

            const branches = user.userBranches
              .filter((ub) => ub.branch.isActive)
              .map((ub) => ({
                id: ub.branch.id,
                name: ub.branch.name,
                isMain: ub.branch.isMain,
              }))
              .sort((a, b) => a.name.localeCompare(b.name));

            const activeBranch =
              branches.find((b) => b.id === hospitalClaims.branchId) ??
              user.userBranches.find((ub) => ub.branchId === hospitalClaims.branchId)?.branch;

            const subscribed = await tx.hospitalModuleSubscription.findMany({
              where: { isActive: true },
              select: { moduleId: true },
            });
            const subscribedIds = new Set(subscribed.map((s) => s.moduleId));

            const moduleRows = await tx.branchModule.findMany({
              where: {
                branchId: hospitalClaims.branchId,
                isActive: true,
                enabledByIndigo: true,
                restrictedByHospital: false,
                module: { isActive: true },
              },
              include: { module: { select: { id: true, code: true, name: true } } },
            });
            const enabledModules = moduleRows
              .filter((row) => subscribedIds.has(row.moduleId))
              .map((row) => ({ code: row.module.code, name: row.module.name }))
              .sort((a, b) => a.code.localeCompare(b.code));

            return {
              user,
              branches,
              activeBranchId: activeBranch?.id ?? hospitalClaims.branchId,
              activeBranchName: activeBranch?.name ?? null,
              enabledModules,
            };
          });
          if (!data) {
            authFailed();
          }
          const roleCodes = [
            ...new Set(
              data.user.roleAssignments
                .filter((a) => a.role.isActive)
                .map((a) => a.role.code)
                .sort(),
            ),
          ];
          return {
            id: data.user.id,
            displayName: data.user.displayName,
            email: data.user.email,
            kind: 'HOSPITAL' as const,
            hospitalName: data.user.hospital.name,
            activeBranchId: data.activeBranchId,
            activeBranchName: data.activeBranchName,
            roleCodes,
            mustChangePassword: data.user.mustChangePassword,
            branches: data.branches,
            enabledModules: data.enabledModules,
          };
        },
      );
    }

    const user = await this.hqPrisma.hqUser.findUnique({ where: { id: claims.userId } });
    if (!user) {
      authFailed();
    }
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      kind: 'HQ',
      hospitalName: null,
      activeBranchId: null,
      activeBranchName: null,
      roleCodes: ['HQ_ADMIN'],
      mustChangePassword: user.mustChangePassword,
      branches: [],
      enabledModules: [],
    };
  }

  private async refreshHospital(
    parts: { tenantId: string; sessionId: string; secret: string },
    meta: { ip: string; userAgent: string | undefined },
  ): Promise<TokenPairResponse> {
    return runWithContext(
      {
        tenantId: parts.tenantId,
        userId: null,
        kind: 'HOSPITAL',
        activeBranchId: null,
        requestId: randomUUID(),
      },
      async () => {
        const outcome = await this.tenantDb.withTenant(async (tx) => {
          const session = await tx.authSession.findFirst({
            where: { id: parts.sessionId },
          });
          if (!session) {
            return { type: 'fail' as const };
          }
          if (!this.tokens.verifyRefreshSecret(parts.secret, session.tokenHash)) {
            return { type: 'fail' as const };
          }
          if (session.revokedAt || session.replacedById) {
            await tx.authSession.updateMany({
              where: { familyId: session.familyId, revokedAt: null },
              data: { revokedAt: new Date() },
            });
            return {
              type: 'reuse' as const,
              userId: session.userId,
              branchId: session.branchId,
            };
          }
          if (session.expiresAt.getTime() <= Date.now()) {
            await tx.authSession.update({
              where: { id: session.id },
              data: { revokedAt: new Date() },
            });
            return { type: 'fail' as const };
          }

          const user = await tx.user.findFirst({ where: { id: session.userId } });
          const branch = await tx.branch.findFirst({ where: { id: session.branchId } });
          const hospital = await tx.hospital.findFirst({ where: { id: parts.tenantId } });
          if (
            !user?.isActive ||
            !branch?.isActive ||
            !hospital ||
            hospital.status !== 'ACTIVE' ||
            !hospital.isActive
          ) {
            await tx.authSession.updateMany({
              where: { familyId: session.familyId, revokedAt: null },
              data: { revokedAt: new Date() },
            });
            return { type: 'fail' as const };
          }

          const member = await tx.userBranch.findFirst({
            where: { userId: user.id, branchId: branch.id, isActive: true },
          });
          if (!member) {
            await tx.authSession.updateMany({
              where: { familyId: session.familyId, revokedAt: null },
              data: { revokedAt: new Date() },
            });
            return { type: 'fail' as const };
          }

          const newSession = await tx.authSession.create({
            data: {
              tenantId: parts.tenantId,
              userId: user.id,
              branchId: branch.id,
              tokenHash: 'pending',
              familyId: session.familyId,
              expiresAt: new Date(Date.now() + this.auth.refreshTokenTtlSec * 1000),
              ip: meta.ip,
              userAgent: meta.userAgent,
            },
          });
          const issued = this.tokens.issueRefreshToken({
            kind: 'hospital',
            tenantId: parts.tenantId,
            sessionId: newSession.id,
          });
          await tx.authSession.update({
            where: { id: newSession.id },
            data: { tokenHash: issued.tokenHash },
          });
          await tx.authSession.update({
            where: { id: session.id },
            data: {
              revokedAt: new Date(),
              replacedById: newSession.id,
              lastUsedAt: new Date(),
            },
          });

          return {
            type: 'ok' as const,
            userId: user.id,
            branchId: branch.id,
            refreshToken: issued.raw,
            mustChangePassword: user.mustChangePassword,
          };
        });

        if (outcome.type === 'reuse') {
          await this.auditHospital('AUTH_REFRESH_REUSE', {
            userId: outcome.userId,
            branchId: outcome.branchId,
          });
          authFailed();
        }
        if (outcome.type !== 'ok') {
          authFailed();
        }

        const accessToken = this.tokens.signHospitalAccess({
          tenantId: parts.tenantId,
          userId: outcome.userId,
          branchId: outcome.branchId,
        });
        return {
          accessToken,
          refreshToken: outcome.refreshToken,
          expiresIn: this.tokens.accessExpiresInSec('HOSPITAL'),
          mustChangePassword: outcome.mustChangePassword,
        };
      },
    );
  }

  private async refreshHq(
    parts: { sessionId: string; secret: string },
    meta: { ip: string; userAgent: string | undefined },
  ): Promise<TokenPairResponse> {
    const session = await this.hqPrisma.hqAuthSession.findUnique({
      where: { id: parts.sessionId },
    });
    if (!session || !this.tokens.verifyRefreshSecret(parts.secret, session.tokenHash)) {
      authFailed();
    }
    if (session.revokedAt || session.replacedById) {
      await this.hqPrisma.hqAuthSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(`HQ refresh reuse detected familyId=${session.familyId}`);
      authFailed();
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.hqPrisma.hqAuthSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      authFailed();
    }

    const user = await this.hqPrisma.hqUser.findUnique({ where: { id: session.userId } });
    if (!user?.isActive) {
      await this.hqPrisma.hqAuthSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      authFailed();
    }

    const newSession = await this.hqPrisma.hqAuthSession.create({
      data: {
        userId: user.id,
        tokenHash: 'pending',
        familyId: session.familyId,
        expiresAt: new Date(Date.now() + this.auth.refreshTokenTtlSec * 1000),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    const issued = this.tokens.issueRefreshToken({ kind: 'hq', sessionId: newSession.id });
    await this.hqPrisma.hqAuthSession.update({
      where: { id: newSession.id },
      data: { tokenHash: issued.tokenHash },
    });
    await this.hqPrisma.hqAuthSession.update({
      where: { id: session.id },
      data: {
        revokedAt: new Date(),
        replacedById: newSession.id,
        lastUsedAt: new Date(),
      },
    });

    const accessToken = this.tokens.signHqAccess({ userId: user.id });
    return {
      accessToken,
      refreshToken: issued.raw,
      expiresIn: this.tokens.accessExpiresInSec('HQ'),
      mustChangePassword: user.mustChangePassword,
    };
  }

  private async createHospitalSession(input: {
    tenantId: string;
    userId: string;
    branchId: string;
    ip: string;
    userAgent: string | undefined;
  }): Promise<TokenPairResponse> {
    const familyId = randomUUID();
    const session = await this.tenantDb.withTenant((tx) =>
      tx.authSession.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          branchId: input.branchId,
          tokenHash: 'pending',
          familyId,
          expiresAt: new Date(Date.now() + this.auth.refreshTokenTtlSec * 1000),
          ip: input.ip,
          userAgent: input.userAgent,
        },
      }),
    );
    const issued = this.tokens.issueRefreshToken({
      kind: 'hospital',
      tenantId: input.tenantId,
      sessionId: session.id,
    });
    await this.tenantDb.withTenant((tx) =>
      tx.authSession.update({
        where: { id: session.id },
        data: { tokenHash: issued.tokenHash },
      }),
    );
    const accessToken = this.tokens.signHospitalAccess({
      tenantId: input.tenantId,
      userId: input.userId,
      branchId: input.branchId,
    });
    return {
      accessToken,
      refreshToken: issued.raw,
      expiresIn: this.tokens.accessExpiresInSec('HOSPITAL'),
      mustChangePassword: false,
    };
  }

  private async createHqSession(input: {
    userId: string;
    ip: string;
    userAgent: string | undefined;
  }): Promise<TokenPairResponse> {
    const familyId = randomUUID();
    const session = await this.hqPrisma.hqAuthSession.create({
      data: {
        userId: input.userId,
        tokenHash: 'pending',
        familyId,
        expiresAt: new Date(Date.now() + this.auth.refreshTokenTtlSec * 1000),
        ip: input.ip,
        userAgent: input.userAgent,
      },
    });
    const issued = this.tokens.issueRefreshToken({ kind: 'hq', sessionId: session.id });
    await this.hqPrisma.hqAuthSession.update({
      where: { id: session.id },
      data: { tokenHash: issued.tokenHash },
    });
    const accessToken = this.tokens.signHqAccess({ userId: input.userId });
    return {
      accessToken,
      refreshToken: issued.raw,
      expiresIn: this.tokens.accessExpiresInSec('HQ'),
      mustChangePassword: false,
    };
  }

  private async auditHospital(
    action: string,
    input: {
      userId?: string;
      branchId: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const ctx = requireContext();
    const tenantId = ctx.tenantId;
    if (!tenantId) {
      return;
    }
    const requestId = ctx.requestId ?? getContext()?.requestId ?? randomUUID();
    await this.tenantDb.withTenant((tx) =>
      tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: input.userId ?? null,
          branchId: input.branchId,
          action,
          entityType: 'auth',
          entityId: input.userId ?? null,
          metadata: { requestId, ...input.metadata },
        },
      }),
    );
  }
}

function shortEmailHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex').slice(0, 12);
}
