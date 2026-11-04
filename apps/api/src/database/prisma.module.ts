import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantDb } from './tenant-db';

/**
 * PrismaService is provided here but NOT exported — feature modules use TenantDb.
 * Seeds and this module remain the only Nest wiring that construct the raw client.
 */
@Global()
@Module({
  providers: [PrismaService, TenantDb],
  exports: [TenantDb],
})
export class PrismaModule {}
