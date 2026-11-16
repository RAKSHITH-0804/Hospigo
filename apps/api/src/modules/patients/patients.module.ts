import { Module } from '@nestjs/common';
import { CLOCK, SystemClock } from '../../common/clock';
import { PatientFieldsService } from './patient-fields.service';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { UhidService } from './uhid.service';

@Module({
  controllers: [PatientsController],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    UhidService,
    PatientFieldsService,
    PatientsService,
  ],
  exports: [UhidService, PatientFieldsService, PatientsService, CLOCK],
})
export class PatientsModule {}
