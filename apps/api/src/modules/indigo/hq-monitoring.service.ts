import { randomBytes, randomInt } from 'node:crypto';
import { ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { HqPrismaService } from '../../database/hq-prisma.service';
import { HealthService } from '../health/health.service';
import { HqPermissionsService } from './hq-permissions.service';
import { HqScopeService } from './hq-scope.service';

/** Where "today" is counted for the monitoring numbers (a hospital day), unless the environment says otherwise. */
const MONITOR_TIMEZONE = process.env.HQ_MONITOR_TIMEZONE || 'Asia/Kolkata';
const ACTIVITY_PAGE = 100;
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const PASSWORD_LENGTH = 14;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function invalid(field: string, reason: string): never {
  throw new HttpException({ statusCode: 400, code: 'INDIGO_INVALID', field, reason }, 400);
}
function temporaryPassword(): string {
  let out = '';
  for (let i = 0; i < PASSWORD_LENGTH - 3; i += 1) {
    out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return `${out}a7K`;
}

/**
 * Phase 2.2: what HQ may see of a hospital without entering it. Counts and dates only (visits, active
 * users, last activity): no patient name and no money. The numbers come from one SECURITY DEFINER
 * function that only reads counts; HQ Staff see only the hospitals assigned to them.
 */
@Injectable()
export class HqMonitoringService {
  constructor(
    private readonly hq: HqPrismaService,
    private readonly access: HqScopeService,
    private readonly perms: HqPermissionsService,
    private readonly health: HealthService,
  ) {}

  private today(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: MONITOR_TIMEZONE }).format(new Date());
  }

  async counts(hqUserId: string) {
    await this.perms.require(hqUserId, 'hq.monitor');
    const visible = await this.access.hospitals(hqUserId);
    const ids = new Set(visible.map((h) => h.id));
    const rows = await this.hq.$queryRaw<
      Array<{
        tenant_id: string;
        visits_today: number;
        visits_7d: number;
        visits_30d: number;
        active_users_30d: number;
        last_activity: Date | null;
      }>
    >`SELECT * FROM hq_hospital_counts(${this.today()}::date)`;
    return {
      items: rows
        .filter((r) => ids.has(r.tenant_id))
        .map((r) => ({
          hospitalId: r.tenant_id,
          visitsToday: r.visits_today,
          visits7d: r.visits_7d,
          visits30d: r.visits_30d,
          activeUsers30d: r.active_users_30d,
          lastActivity: r.last_activity ? r.last_activity.toISOString() : null,
        })),
    };
  }

  /** One system status for the HQ home: API, database, storage and migrations. */
  async systemHealth(hqUserId: string) {
    await this.perms.require(hqUserId, 'hq.monitor');
    const d = await this.health.getDetails();
    return {
      status: d.status,
      checkedAt: d.checkedAt,
      api: 'up' as const,
      database: d.services.postgres.status,
      storage: d.services.storage.status,
      migrations: d.migrations.status,
    };
  }

  /** The HQ activity log (HQ Admin only): who changed what in which hospital, newest first. */
  async activity(hqUserId: string, page: number) {
    await this.perms.require(hqUserId, 'hq.activity.read');
    const skip = (Math.max(1, Math.trunc(page) || 1) - 1) * ACTIVITY_PAGE;
    const [rows, total] = await Promise.all([
      this.hq.hqActivityLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: ACTIVITY_PAGE,
      }),
      this.hq.hqActivityLog.count(),
    ]);
    const people = await this.hq.hqUser.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.hqUserId))] } },
      select: { id: true, displayName: true },
    });
    const hospitals = await this.hq.hospital.findMany({
      where: { id: { in: [...new Set(rows.flatMap((r) => (r.tenantId ? [r.tenantId] : [])))] } },
      select: { id: true, name: true },
    });
    const personName = new Map(people.map((p) => [p.id, p.displayName]));
    const hospitalName = new Map(hospitals.map((h) => [h.id, h.name]));
    return {
      total,
      pageSize: ACTIVITY_PAGE,
      items: rows.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        person: personName.get(r.hqUserId) ?? null,
        hospital: r.tenantId ? (hospitalName.get(r.tenantId) ?? null) : null,
        action: r.action,
        entityType: r.entityType,
      })),
    };
  }

  private async scoped(hqUserId: string, hospitalId: string): Promise<void> {
    const visible = await this.access.hospitals(hqUserId);
    if (!visible.some((h) => h.id === hospitalId)) {
      throw new ForbiddenException();
    }
  }

  /** The Super Admin accounts of a hospital (name, email, last sign-in): no way into the hospital. */
  async superAdmins(hqUserId: string, hospitalId: string) {
    await this.perms.require(hqUserId, 'hq.hospitals.view');
    await this.scoped(hqUserId, hospitalId);
    const rows = await this.hq.$queryRaw<
      Array<{
        id: string;
        email: string;
        display_name: string;
        is_active: boolean;
        last_login_at: Date | null;
      }>
    >`SELECT * FROM hq_list_superadmins(${hospitalId})`;
    return {
      items: rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        isActive: r.is_active,
        lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null,
      })),
    };
  }

  /** The first Super Admin of a hospital that has none (the database refuses a second one). */
  async createSuperAdmin(hqUserId: string, hospitalId: string, body: unknown) {
    await this.perms.require(hqUserId, 'hq.superadmin.reset');
    await this.scoped(hqUserId, hospitalId);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      invalid('body', 'REQUIRED');
    }
    const b = body as Record<string, unknown>;
    for (const key of Object.keys(b)) {
      if (!['name', 'email'].includes(key)) {
        invalid(key, 'UNKNOWN_FIELD');
      }
    }
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    if (!name || name.length > 120) {
      invalid('name', 'INVALID');
    }
    if (!EMAIL.test(email) || email.length > 200) {
      invalid('email', 'INVALID');
    }
    const password = temporaryPassword();
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const code = `SA-${randomBytes(3).toString('hex').toUpperCase()}`;
    try {
      await this.hq
        .$queryRaw`SELECT hq_create_first_superadmin(${hospitalId}, ${code}, ${email}, ${name}, ${hash})`;
    } catch {
      throw new HttpException(
        { statusCode: 409, code: 'INDIGO_CONFLICT', field: 'superAdmin', reason: 'NOT_POSSIBLE' },
        409,
      );
    }
    await this.perms.activity(hqUserId, hospitalId, 'HQ_SUPERADMIN_CREATE', 'user', null, {});
    return { email, temporaryPassword: password };
  }

  /** A one-time password for one Super Admin of the hospital (the old sessions end); shown once. */
  async resetSuperAdmin(hqUserId: string, hospitalId: string, userId: string) {
    await this.perms.require(hqUserId, 'hq.superadmin.reset');
    await this.scoped(hqUserId, hospitalId);
    const password = temporaryPassword();
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const rows = await this.hq.$queryRaw<
      Array<{ ok: boolean }>
    >`SELECT hq_reset_superadmin(${hospitalId}, ${userId}, ${hash}) AS ok`;
    if (!rows[0]?.ok) {
      throw new ForbiddenException();
    }
    await this.perms.activity(hqUserId, hospitalId, 'HQ_SUPERADMIN_RESET', 'user', userId, {});
    return { temporaryPassword: password };
  }
}
