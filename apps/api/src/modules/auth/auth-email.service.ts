import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { ApiEnv } from '../../config/env';
import { runWithContext } from '../../common/request-context';
import {
  consumeHospitalActionTokenRow,
  consumeHqActionTokenRow,
  runHqTransaction,
} from '../../database/auth-action-consume';
import { BranchAccessLookup } from '../../database/branch-access.lookup';
import { HqPrismaService } from '../../database/hq-prisma.service';
import { TenantDb } from '../../database/tenant-db';
import { AuthActionPurpose } from '../../generated/prisma';
import { MailService } from '../mail/mail.service';
import { ActionTokenService } from './action-token.service';
import type { AuthConfig } from './auth.config';
import { AuthRedisService } from './auth-redis.service';
import { MembershipHelper } from './membership.helper';
import { PasswordService } from './password.service';

const INVALID_LINK = 'Invalid or expired link';

@Injectable()
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);
  private readonly auth: AuthConfig;

  constructor(
    private readonly mail: MailService,
    private readonly tokens: ActionTokenService,
    private readonly redis: AuthRedisService,
    private readonly branchLookup: BranchAccessLookup,
    private readonly tenantDb: TenantDb,
    private readonly hqPrisma: HqPrismaService,
    private readonly membership: MembershipHelper,
    private readonly passwords: PasswordService,
    config: ConfigService<ApiEnv, true>,
  ) {
    this.auth = config.getOrThrow('auth', { infer: true });
  }

  /** Enqueue activation email for staff-creation screens. */
  async sendActivation(tenantId: string, userId: string): Promise<void> {
    await this.mail.enqueue({
      kind: 'ACTIVATION',
      tenantId,
      userId,
    });
  }

  async forgotPassword(
    input: { accessCode: string; email: string },
    meta: { ip: string },
  ): Promise<{ accepted: true }> {
    await this.redis.assertIpAllowed(meta.ip);
    const accountHash = this.redis.accountKeyMaterial(input.accessCode, input.email);
    await this.redis.assertResetAccountAllowed(accountHash);

    return this.withMinDuration(this.auth.forgotPasswordMinResponseMs, async () => {
      const target = await this.resolveHospitalResetTarget(input.accessCode, input.email);
      if (target) {
        await this.mail.enqueue({
          kind: 'PASSWORD_RESET',
          tenantId: target.tenantId,
          userId: target.userId,
        });
      }
      return { accepted: true as const };
    });
  }

  async hqForgotPassword(
    input: { email: string },
    meta: { ip: string },
  ): Promise<{ accepted: true }> {
    await this.redis.assertIpAllowed(meta.ip);
    const accountHash = this.redis.accountKeyMaterial(null, `hq|${input.email}`);
    await this.redis.assertResetAccountAllowed(accountHash);

    return this.withMinDuration(this.auth.forgotPasswordMinResponseMs, async () => {
      const email = input.email.trim().toLowerCase();
      const user = await this.hqPrisma.hqUser.findUnique({ where: { email } });
      if (user && user.isActive) {
        await this.mail.enqueue({
          kind: 'HQ_PASSWORD_RESET',
          tenantId: null,
          userId: user.id,
        });
      }
      return { accepted: true as const };
    });
  }

  async resetPassword(
    input: { token: string; newPassword: string },
    meta: { ip: string },
  ): Promise<void> {
    await this.redis.assertIpAllowed(meta.ip);
    await this.consumeActionToken({
      rawToken: input.token,
      newPassword: input.newPassword,
      allowedPurposes: [AuthActionPurpose.PASSWORD_RESET],
      auditAction: 'AUTH_PASSWORD_RESET',
    });
  }

  async activate(
    input: { token: string; newPassword: string },
    meta: { ip: string },
  ): Promise<void> {
    await this.redis.assertIpAllowed(meta.ip);
    await this.consumeActionToken({
      rawToken: input.token,
      newPassword: input.newPassword,
      allowedPurposes: [AuthActionPurpose.ACTIVATION],
      auditAction: 'AUTH_ACTIVATION',
      hospitalOnly: true,
    });
  }

  private async resolveHospitalResetTarget(
    accessCode: string,
    emailRaw: string,
  ): Promise<{ tenantId: string; userId: string; branchId: string } | null> {
    const branch = await this.branchLookup.findByAccessCode(accessCode);
    if (!branch) {
      return null;
    }
    const email = emailRaw.trim().toLowerCase();
    return runWithContext(
      {
        tenantId: branch.tenantId,
        userId: null,
        kind: 'HOSPITAL',
        activeBranchId: branch.branchId,
        requestId: randomUUID(),
      },
      async () => {
        const user = await this.tenantDb.withTenant((tx) =>
          tx.user.findFirst({
            where: { email: { equals: email, mode: 'insensitive' }, isActive: true },
          }),
        );
        if (!user) {
          return null;
        }
        const member = await this.membership.hasActiveBranchMembership(user.id, branch.branchId);
        if (!member) {
          return null;
        }
        return { tenantId: branch.tenantId, userId: user.id, branchId: branch.branchId };
      },
    );
  }

  private async consumeActionToken(input: {
    rawToken: string;
    newPassword: string;
    allowedPurposes: AuthActionPurpose[];
    auditAction: string;
    hospitalOnly?: boolean;
  }): Promise<void> {
    const parsed = this.tokens.parseToken(input.rawToken);
    if (!parsed) {
      throw new BadRequestException(INVALID_LINK);
    }
    if (input.hospitalOnly && parsed.kind !== 'hospital') {
      throw new BadRequestException(INVALID_LINK);
    }

    // Validate token exists / secret / purpose / expiry BEFORE password rules (token not consumed).
    if (parsed.kind === 'hq') {
      await this.assertHqTokenUsable(parsed.tokenId, parsed.secret);
    } else {
      await this.assertHospitalTokenUsable(
        parsed.tenantId,
        parsed.tokenId,
        parsed.secret,
        input.allowedPurposes,
      );
    }

    const check = this.passwords.validatePlainPassword(input.newPassword);
    if (!check.ok) {
      throw new BadRequestException(`Password rejected: ${check.reason}`);
    }

    if (parsed.kind === 'hq') {
      await this.consumeHqReset(parsed.tokenId, parsed.secret, input.newPassword);
      return;
    }

    await this.consumeHospitalToken({
      tenantId: parsed.tenantId,
      tokenId: parsed.tokenId,
      secret: parsed.secret,
      newPassword: input.newPassword,
      allowedPurposes: input.allowedPurposes,
      auditAction: input.auditAction,
    });
  }

  private async assertHospitalTokenUsable(
    tenantId: string,
    tokenId: string,
    secret: string,
    allowedPurposes: AuthActionPurpose[],
  ): Promise<void> {
    await runWithContext(
      {
        tenantId,
        userId: null,
        kind: 'HOSPITAL',
        activeBranchId: null,
        requestId: randomUUID(),
      },
      async () => {
        await this.tenantDb.withTenant(async (tx) => {
          const existing = await tx.authActionToken.findFirst({
            where: { id: tokenId, usedAt: null, expiresAt: { gt: new Date() } },
          });
          if (
            !existing ||
            !allowedPurposes.includes(existing.purpose) ||
            !this.tokens.verifySecret(secret, existing.tokenHash)
          ) {
            throw new BadRequestException(INVALID_LINK);
          }
        });
      },
    );
  }

  private async assertHqTokenUsable(tokenId: string, secret: string): Promise<void> {
    const existing = await this.hqPrisma.hqAuthActionToken.findFirst({
      where: {
        id: tokenId,
        purpose: AuthActionPurpose.PASSWORD_RESET,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!existing || !this.tokens.verifySecret(secret, existing.tokenHash)) {
      throw new BadRequestException(INVALID_LINK);
    }
  }

  private async consumeHospitalToken(input: {
    tenantId: string;
    tokenId: string;
    secret: string;
    newPassword: string;
    allowedPurposes: AuthActionPurpose[];
    auditAction: string;
  }): Promise<void> {
    const requestId = randomUUID();
    await runWithContext(
      {
        tenantId: input.tenantId,
        userId: null,
        kind: 'HOSPITAL',
        activeBranchId: null,
        requestId,
      },
      async () => {
        await this.tenantDb.withTenant(async (tx) => {
          const existing = await tx.authActionToken.findFirst({
            where: {
              id: input.tokenId,
              usedAt: null,
              expiresAt: { gt: new Date() },
            },
          });
          if (
            !existing ||
            !input.allowedPurposes.includes(existing.purpose) ||
            !this.tokens.verifySecret(input.secret, existing.tokenHash)
          ) {
            throw new BadRequestException(INVALID_LINK);
          }

          const row = await consumeHospitalActionTokenRow(tx, {
            tenantId: input.tenantId,
            tokenId: input.tokenId,
          });
          if (!row) {
            throw new BadRequestException(INVALID_LINK);
          }

          const user = await tx.user.findFirst({ where: { id: row.userId } });
          if (!user || !user.isActive) {
            throw new BadRequestException(INVALID_LINK);
          }

          const passwordHash = await this.passwords.hashTrusted(input.newPassword);
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
          await tx.authActionToken.updateMany({
            where: { userId: user.id, usedAt: null, id: { not: row.id } },
            data: { usedAt: new Date() },
          });

          const membership = await tx.userBranch.findFirst({
            where: { userId: user.id, isActive: true },
            select: { branchId: true },
          });
          await tx.auditLog.create({
            data: {
              tenantId: input.tenantId,
              actorUserId: user.id,
              branchId: membership?.branchId ?? null,
              action: input.auditAction,
              entityType: 'auth',
              entityId: user.id,
              metadata: { requestId },
            },
          });
        });
      },
    );
  }

  private async consumeHqReset(
    tokenId: string,
    secret: string,
    newPassword: string,
  ): Promise<void> {
    let hqUserIdForLog: string | undefined;
    await runHqTransaction(this.hqPrisma, async (tx) => {
      const existing = await tx.hqAuthActionToken.findFirst({
        where: {
          id: tokenId,
          purpose: AuthActionPurpose.PASSWORD_RESET,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (!existing || !this.tokens.verifySecret(secret, existing.tokenHash)) {
        throw new BadRequestException(INVALID_LINK);
      }

      const row = await consumeHqActionTokenRow(tx, tokenId);
      if (!row) {
        throw new BadRequestException(INVALID_LINK);
      }
      const user = await tx.hqUser.findUnique({ where: { id: row.hqUserId } });
      if (!user || !user.isActive) {
        throw new BadRequestException(INVALID_LINK);
      }
      hqUserIdForLog = user.id;
      const passwordHash = await this.passwords.hashTrusted(newPassword);
      await tx.hqUser.update({
        where: { id: user.id },
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
        },
      });
      await tx.hqAuthSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.hqAuthActionToken.updateMany({
        where: { hqUserId: user.id, usedAt: null, id: { not: row.id } },
        data: { usedAt: new Date() },
      });
    });
    this.logger.log(`HQ password reset completed userId=${hqUserIdForLog ?? 'unknown'}`);
  }

  private async withMinDuration<T>(minMs: number, fn: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      const elapsed = Date.now() - started;
      if (minMs > 0 && elapsed < minMs) {
        await new Promise((r) => setTimeout(r, minMs - elapsed));
      }
    }
  }
}
