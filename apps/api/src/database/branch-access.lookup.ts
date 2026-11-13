import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma';
import { PrismaService } from './prisma.service';

export type BranchAccessHit = {
  branchId: string;
  tenantId: string;
  isMain: boolean;
};

/**
 * Pre-auth SECURITY DEFINER lookup. Lives in database/ so it may use PrismaService.
 * Unknown / inactive codes return null (identical empty result from Postgres).
 */
@Injectable()
export class BranchAccessLookup {
  constructor(private readonly prisma: PrismaService) {}

  async findByAccessCode(code: string): Promise<BranchAccessHit | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ branch_id: string; tenant_id: string; is_main: boolean }>
    >(Prisma.sql`SELECT branch_id, tenant_id, is_main FROM lookup_branch_by_access_code(${code})`);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      branchId: row.branch_id,
      tenantId: row.tenant_id,
      isMain: row.is_main,
    };
  }
}
