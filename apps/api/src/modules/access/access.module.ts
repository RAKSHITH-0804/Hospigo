import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessService } from './access.service';
import { PermissionGuard } from './permission.guard';

@Module({
  providers: [
    AccessService,
    PermissionGuard,
    // Runs after AuthGuard (registered first in AuthModule).
    { provide: APP_GUARD, useExisting: PermissionGuard },
  ],
  exports: [AccessService, PermissionGuard],
})
export class AccessModule {}
