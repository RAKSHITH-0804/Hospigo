import { Global, Module } from '@nestjs/common';
import { BranchAccessLookup } from './branch-access.lookup';
import { PrismaService } from './prisma.service';
import { TenantDb } from './tenant-db';

/**
 * PrismaService is provided here but NOT exported — feature modules use TenantDb.
 * BranchAccessLookup is the pre-auth door for access-code resolution (exports only that).
 * Seeds and this module remain the only Nest wiring that construct the raw app client.
 */
@Global()
@Module({
  providers: [PrismaService, TenantDb, BranchAccessLookup],
  exports: [TenantDb, BranchAccessLookup],
})
export class PrismaModule {}
