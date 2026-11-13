import { Module } from '@nestjs/common';
import { DoctorAvailabilityService } from './doctor-availability.service';
import { OpdSettingsService } from './opd-settings.service';
import { PriceService } from './price.service';

@Module({
  providers: [PriceService, DoctorAvailabilityService, OpdSettingsService],
  exports: [PriceService, DoctorAvailabilityService, OpdSettingsService],
})
export class OpdMastersModule {}
