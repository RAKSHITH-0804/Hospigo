import { ForbiddenException, Injectable } from '@nestjs/common';
import { HqPrismaService } from '../../database/hq-prisma.service';

/**
 * What an HQ person may do (Phase 2.2). An HQ Admin has every permission; HQ Staff only the ones an
 * HQ Admin ticked. `hq.staff.manage` is never tickable: only an HQ Admin manages HQ Staff.
 * Deny by default: no row, no right. Read from the database on every call, never from a token.
 */
export const HQ_PERMISSIONS = [
  'hq.hospitals.view',
  'hq.monitor',
  'hq.onboard',
  'hq.modules',
  'hq.print',
  'hq.terminology',
  'hq.superadmin.reset',
] as const;
export type HqPermission = (typeof HQ_PERMISSIONS)[number] | 'hq.staff.manage' | 'hq.activity.read';

export const HQ_ADMIN_ONLY: readonly HqPermission[] = ['hq.staff.manage', 'hq.activity.read'];

@Injectable()
export class HqPermissionsService {
  constructor(private readonly hq: HqPrismaService) {}

  /** Every permission of this person (the full list for an HQ Admin, the ticked ones for HQ Staff). */
  async listFor(hqUserId: string): Promise<HqPermission[]> {
    const person = await this.hq.hqUser.findUnique({
      where: { id: hqUserId },
      select: { isActive: true, indigoRole: true },
    });
    if (!person?.isActive) {
      return [];
    }
    if (person.indigoRole === 'OWNER') {
      return [...HQ_PERMISSIONS, ...HQ_ADMIN_ONLY];
    }
    if (person.indigoRole !== 'EMPLOYEE') {
      return [];
    }
    const rows = await this.hq.hqUserPermission.findMany({
      where: { hqUserId },
      select: { permission: true },
    });
    const known = new Set<string>(HQ_PERMISSIONS);
    return rows.map((r) => r.permission).filter((p): p is HqPermission => known.has(p));
  }

  async has(hqUserId: string, permission: HqPermission): Promise<boolean> {
    return (await this.listFor(hqUserId)).includes(permission);
  }

  /** The same 403 for every refusal (no hint which part failed). */
  async require(hqUserId: string, permission: HqPermission): Promise<void> {
    if (!(await this.has(hqUserId, permission))) {
      throw new ForbiddenException();
    }
  }

  /** Append one line to the HQ activity log: who, what, which hospital. Names and ids only. */
  async activity(
    hqUserId: string,
    tenantId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    detail: Record<string, unknown> = {},
  ): Promise<void> {
    await this.hq.hqActivityLog.createMany({
      data: [{ hqUserId, tenantId, action, entityType, entityId, detail: detail as object }],
    });
  }
}
