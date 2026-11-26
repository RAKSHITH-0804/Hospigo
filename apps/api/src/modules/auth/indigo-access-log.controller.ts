import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../access/permission.decorators';
import { TenantDb } from '../../database/tenant-db';
import { TokenKinds } from './token-kinds.decorator';
import type { HospitalAccessClaims } from './token.types';

type HttpReq = { auth?: unknown };

const PAGE_SIZE = 50;

/**
 * Step 2.1b: who from Indigo entered THIS hospital, and when. Read by the hospital's SuperAdmin (the
 * permission) and, through the HQ side, by Indigo. The list holds ids and the shown name of the
 * hidden Indigo user, never anything about patients. Row level security keeps it to this hospital.
 */
@ApiTags('indigo-access')
@ApiBearerAuth()
@Controller('indigo-access-log')
export class IndigoAccessLogController {
  constructor(private readonly tenantDb: TenantDb) {}

  @Get()
  @TokenKinds('HOSPITAL')
  @RequirePermission('indigo.access.read')
  @ApiOperation({ summary: 'Who from Indigo entered this hospital (newest first, 50 a page)' })
  async list(@Req() req: HttpReq, @Query('page') page?: string) {
    const claims = req.auth as HospitalAccessClaims;
    const pageNo = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
    return this.tenantDb.withTenant(async (tx) => {
      const where = { tenantId: claims.tenantId };
      const [total, rows] = await Promise.all([
        tx.indigoAccessLog.count({ where }),
        tx.indigoAccessLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (pageNo - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);
      const users = await tx.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
        select: { id: true, displayName: true },
      });
      const names = new Map(users.map((u) => [u.id, u.displayName]));
      return {
        items: rows.map((r) => ({
          id: r.id,
          action: r.action,
          person: names.get(r.userId) ?? null,
          at: r.createdAt.toISOString(),
        })),
        total,
        page: pageNo,
        pageSize: PAGE_SIZE,
      };
    });
  }
}
