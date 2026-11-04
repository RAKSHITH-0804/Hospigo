import { Module } from '@nestjs/common';
import { CLOCK, SystemClock } from '../../common/clock';
import { PatientFieldsService } from './patient-fields.service';
import { PatientsService } from './patients.service';
import { UhidService } from './uhid.service';

@Module({
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    UhidService,
    PatientFieldsService,
    PatientsService,
  ],
  exports: [UhidService, PatientFieldsService, PatientsService, CLOCK],
})
export class PatientsModule {}
