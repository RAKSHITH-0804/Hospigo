import { Module } from '@nestjs/common';
import { CLOCK, SystemClock } from '../../common/clock';
import { AccessModule } from '../access/access.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [AccessModule],
  controllers: [DashboardController],
  providers: [{ provide: CLOCK, useClass: SystemClock }, DashboardService],
})
export class DashboardModule {}
