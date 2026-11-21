import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { ImagesModule } from '../images/images.module';
import { DoctorProfilesController } from './doctor-profiles.controller';
import { DoctorProfilesService } from './doctor-profiles.service';

@Module({
  imports: [AccessModule, ImagesModule],
  controllers: [DoctorProfilesController],
  providers: [DoctorProfilesService],
})
export class DoctorProfilesModule {}
