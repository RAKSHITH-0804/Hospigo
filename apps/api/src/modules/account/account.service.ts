import { Injectable, UnauthorizedException } from '@nestjs/common';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { PasswordService } from '../auth/password.service';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import { STAFF_LIMITS } from '../staff/staff.config';
import {
  isRecord,
  readEmail,
  readPhone,
  readText,
  refuse,
  StaffReason,
} from '../staff/staff.rules';
import { StaffOtpService } from './staff-otp.service';

type Actor = { tenantId: string; userId: string };

export type AccountView = {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string | null;
  branches: string[];
  roles: string[];
  /** The person has an active doctor profile (the doctor section of My profile is shown). */
  isDoctor: boolean;
  limits: { nameMax: number; phoneMax: number };
};

/**
 * "My profile" for every person: name, phone, email and password. The person is found from the
 * token, never from the request. Changing the email address or the password first needs a code sent
 * to the mailbox (the new address for an email change, the own address for a password change).
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly otp: StaffOtpService,
    private readonly passwords: PasswordService,
  ) {}

  async me(actor: Actor): Promise<AccountView> {
    await this.requireActive(actor);
    return this.tenantDb.withTenant(async (tx) => this.view(tx, actor));
  }

  async updateMe(actor: Actor, body: unknown): Promise<AccountView> {
    await this.requireActive(actor);
    if (!isRecord(body)) {
      refuse('body', StaffReason.REQUIRED);
    }
    const name =
      body.name === undefined ? undefined : readText(body.name, 'name', STAFF_LIMITS.nameMax);
    const phone = body.phone === undefined ? undefined : readPhone(body.phone);
    if (name === undefined && phone === undefined) {
      refuse('body', StaffReason.REQUIRED);
    }
    return this.tenantDb.withTenant(async (tx) => {
      await tx.user.update({
        where: { id: actor.userId },
        data: {
          ...(name !== undefined ? { displayName: name } : {}),
          ...(phone !== undefined ? { phone } : {}),
        },
      });
      await this.audit(tx, actor, 'ACCOUNT_CHANGE', {
        changed: [
          ...(name !== undefined ? ['name'] : []),
          ...(phone !== undefined ? ['phone'] : []),
        ],
      });
      return this.view(tx, actor);
    });
  }

  // --------------------------------------------------------------------- email address

  /** Sends a code to the NEW address. The old address keeps working until the code is confirmed. */
  async requestEmailChange(actor: Actor, body: unknown, ip: string): Promise<{ sent: true }> {
    await this.requireActive(actor);
    if (!isRecord(body)) {
      refuse('body', StaffReason.REQUIRED);
    }
    const email = readEmail(body.email);
    await this.tenantDb.withTenant(async (tx) => {
      const me = await tx.user.findFirstOrThrow({ where: { id: actor.userId } });
      if (me.email.toLowerCase() === email) {
        refuse('email', 'SAME');
      }
      await this.requireFreeEmail(tx, actor.tenantId, email, actor.userId);
    });
    await this.otp.request({
      tenantId: actor.tenantId,
      userId: actor.userId,
      purpose: 'EMAIL',
      to: email,
      ip,
      pendingEmail: email,
    });
    return { sent: true };
  }

  async confirmEmailChange(actor: Actor, body: unknown): Promise<AccountView> {
    await this.requireActive(actor);
    const code = readCode(body);
    const { pendingEmail } = await this.otp.verify({
      tenantId: actor.tenantId,
      userId: actor.userId,
      purpose: 'EMAIL',
      code,
    });
    if (!pendingEmail) {
      throw opdError(400, OpdErrorCode.OTP_INVALID, { reason: 'EXPIRED' });
    }
    return this.tenantDb.withTenant(async (tx) => {
      await this.requireFreeEmail(tx, actor.tenantId, pendingEmail, actor.userId);
      try {
        await tx.user.update({ where: { id: actor.userId }, data: { email: pendingEmail } });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
          refuse('email', StaffReason.DUPLICATE);
        }
        throw error;
      }
      await this.audit(tx, actor, 'ACCOUNT_EMAIL_CHANGE', { changed: ['email'] });
      return this.view(tx, actor);
    });
  }

  // -------------------------------------------------------------------------- password

  /** Sends a code to the person's OWN address; the address typed must be it. */
  async requestPasswordChange(actor: Actor, body: unknown, ip: string): Promise<{ sent: true }> {
    await this.requireActive(actor);
    if (!isRecord(body)) {
      refuse('body', StaffReason.REQUIRED);
    }
    const email = readEmail(body.email);
    const own = await this.tenantDb.withTenant((tx) =>
      tx.user.findFirstOrThrow({ where: { id: actor.userId }, select: { email: true } }),
    );
    if (own.email.toLowerCase() !== email) {
      refuse('email', 'MISMATCH');
    }
    await this.otp.request({
      tenantId: actor.tenantId,
      userId: actor.userId,
      purpose: 'PASSWORD',
      to: own.email,
      ip,
    });
    return { sent: true };
  }

  /**
   * Checks the new password first (a typo must not use up the code), then the code, then changes the
   * password and ends every session of the person: they sign in again with the new password.
   */
  async confirmPasswordChange(
    actor: Actor,
    body: unknown,
  ): Promise<{ changed: true; signedOutEverywhere: true }> {
    await this.requireActive(actor);
    const code = readCode(body);
    const record = body as Record<string, unknown>;
    const password = record.newPassword;
    if (typeof password !== 'string' || password.length === 0) {
      refuse('newPassword', StaffReason.REQUIRED);
    }
    const check = this.passwords.validatePlainPassword(password);
    if (!check.ok) {
      refuse('newPassword', check.reason);
    }
    await this.otp.verify({
      tenantId: actor.tenantId,
      userId: actor.userId,
      purpose: 'PASSWORD',
      code,
    });
    const hash = await this.passwords.hash(password);
    await this.tenantDb.withTenant(async (tx) => {
      await tx.user.update({
        where: { id: actor.userId },
        data: { passwordHash: hash, mustChangePassword: false, passwordChangedAt: new Date() },
      });
      await tx.authSession.updateMany({
        where: { tenantId: actor.tenantId, userId: actor.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit(tx, actor, 'ACCOUNT_PASSWORD_CHANGE', { changed: ['password'] });
    });
    return { changed: true, signedOutEverywhere: true };
  }

  // ----------------------------------------------------------------------------- helpers

  /**
   * A person who was switched off keeps a working access token until it expires, and these routes ask
   * for no permission, so every call checks the account is still on. A switched-off person gets 401.
   */
  private async requireActive(actor: Actor): Promise<void> {
    const row = await this.tenantDb.withTenant((tx) =>
      tx.user.findFirst({
        where: { id: actor.userId, tenantId: actor.tenantId },
        select: { isActive: true },
      }),
    );
    if (!row?.isActive) {
      throw new UnauthorizedException();
    }
  }

  private async view(tx: TenantTx, actor: Actor): Promise<AccountView> {
    const row = await tx.user.findFirstOrThrow({
      where: { id: actor.userId, tenantId: actor.tenantId },
      include: {
        userBranches: {
          where: { isActive: true },
          include: { branch: { select: { name: true } } },
        },
        roleAssignments: {
          where: { isActive: true },
          include: { role: { select: { name: true } } },
        },
        doctorProfiles: { where: { active: true }, select: { id: true } },
      },
    });
    return {
      id: row.id,
      code: row.code,
      name: row.displayName,
      email: row.email,
      phone: row.phone,
      branches: row.userBranches.map((b) => b.branch.name).sort(),
      roles: [...new Set(row.roleAssignments.map((a) => a.role.name))].sort(),
      isDoctor: row.doctorProfiles.length > 0,
      limits: { nameMax: STAFF_LIMITS.nameMax, phoneMax: STAFF_LIMITS.phoneMax },
    };
  }

  private async requireFreeEmail(
    tx: TenantTx,
    tenantId: string,
    email: string,
    exceptUserId: string,
  ): Promise<void> {
    const taken = await tx.user.findFirst({
      where: { tenantId, email: { equals: email, mode: 'insensitive' }, NOT: { id: exceptUserId } },
      select: { id: true },
    });
    if (taken) {
      refuse('email', StaffReason.DUPLICATE);
    }
  }

  /** The audit trail keeps what kind of change it was, never the new values. */
  private async audit(
    tx: TenantTx,
    actor: Actor,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action,
        entityType: 'users',
        entityId: actor.userId,
        reason: 'Person changed their own account',
        metadata: metadata as object,
      },
    });
  }
}

/** The code the person typed: digits only, as many as the code has. */
function readCode(body: unknown): string {
  if (!isRecord(body)) {
    refuse('body', StaffReason.REQUIRED);
  }
  const code = body.code;
  if (typeof code !== 'string' || code.trim().length === 0) {
    refuse('code', StaffReason.REQUIRED);
  }
  const text = code.trim();
  if (!/^\d{4,10}$/.test(text)) {
    refuse('code', StaffReason.INVALID);
  }
  return text;
}
