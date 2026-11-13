import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma';
import { requireContext } from '../common/request-context';
import { PrismaService } from './prisma.service';

export type TenantTx = Prisma.TransactionClient;

/**
 * The only tenant-scoped database door for feature code.
 * Sets app.tenant_id LOCAL to the transaction from request context.
 * Nothing outside this class may set the tenant session variable.
 */
@Injectable()
export class TenantDb {
  constructor(private readonly prisma: PrismaService) {}

  async withTenant<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    const ctx = requireContext();
    if (ctx.kind === 'HQ' || ctx.kind === 'PATIENT') {
      throw new Error(`TenantDb refused: ${ctx.kind} context cannot open a tenant transaction`);
    }
    if (!ctx.tenantId) {
      throw new Error('TenantDb refused: no tenant in request context');
    }
    const tenantId = ctx.tenantId;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }
}
