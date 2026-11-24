import { Module } from '@nestjs/common';
import { CLOCK, SystemClock } from '../../common/clock';
import { AccessModule } from '../access/access.module';
import { DoctorAvailabilityModule } from '../doctor-availability/availability.module';
import { LeaveRequestsController } from './leave-requests.controller';
import { LeaveRequestsService } from './leave-requests.service';

@Module({
  imports: [AccessModule, DoctorAvailabilityModule],
  controllers: [LeaveRequestsController],
  providers: [{ provide: CLOCK, useClass: SystemClock }, LeaveRequestsService],
})
export class LeaveRequestsModule {}
