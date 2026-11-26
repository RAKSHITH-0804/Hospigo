import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [AccessModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
