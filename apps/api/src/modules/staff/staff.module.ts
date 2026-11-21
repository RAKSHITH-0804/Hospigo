import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuthModule } from '../auth/auth.module';
import { RolesService } from './roles.service';
import { StaffCodeService } from './staff-code.service';
import { RolesController, StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [AccessModule, AuthModule],
  controllers: [StaffController, RolesController],
  providers: [StaffService, RolesService, StaffCodeService],
})
export class StaffModule {}
