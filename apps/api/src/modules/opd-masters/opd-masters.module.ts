import { Module } from '@nestjs/common';
import { DoctorAvailabilityService } from './doctor-availability.service';
import { OpdRulesService } from './opd-rules.service';
import { OpdSettingsService } from './opd-settings.service';
import { PriceService } from './price.service';

@Module({
  providers: [PriceService, DoctorAvailabilityService, OpdSettingsService, OpdRulesService],
  exports: [PriceService, DoctorAvailabilityService, OpdSettingsService, OpdRulesService],
})
export class OpdMastersModule {}
