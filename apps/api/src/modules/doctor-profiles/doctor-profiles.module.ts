import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { DoctorProfilesController } from './doctor-profiles.controller';
import { DoctorProfilesService } from './doctor-profiles.service';

@Module({
  imports: [AccessModule],
  controllers: [DoctorProfilesController],
  providers: [DoctorProfilesService],
})
export class DoctorProfilesModule {}
