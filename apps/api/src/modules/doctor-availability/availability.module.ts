import { Module } from '@nestjs/common';
import { CLOCK, SystemClock } from '../../common/clock';
import { AccessModule } from '../access/access.module';
import { DoctorAvailabilityController } from './availability.controller';
import { DoctorAvailabilityAdminService } from './availability.service';

@Module({
  imports: [AccessModule],
  controllers: [DoctorAvailabilityController],
  providers: [{ provide: CLOCK, useClass: SystemClock }, DoctorAvailabilityAdminService],
})
export class DoctorAvailabilityModule {}
