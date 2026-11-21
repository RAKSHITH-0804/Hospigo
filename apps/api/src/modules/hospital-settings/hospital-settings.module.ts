import { Module } from '@nestjs/common';
import { OpdMastersModule } from '../opd-masters/opd-masters.module';
import { PatientFieldSettingsService } from '../patients/patient-field-settings.service';
import { PatientsModule } from '../patients/patients.module';
import { HospitalSettingsController } from './hospital-settings.controller';

@Module({
  imports: [OpdMastersModule, PatientsModule],
  controllers: [HospitalSettingsController],
  providers: [PatientFieldSettingsService],
})
export class HospitalSettingsModule {}
