import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { NumberingModule } from '../numbering/numbering.module';
import { ConsultationService } from './consultation.service';
import { OpdClinicalController } from './opd-clinical.controller';
import { PatientHistoryController } from './patient-history.controller';
import { PatientHistoryService } from './patient-history.service';
import { VitalsService } from './vitals.service';

@Module({
  imports: [AccessModule, NumberingModule],
  controllers: [OpdClinicalController, PatientHistoryController],
  providers: [ConsultationService, VitalsService, PatientHistoryService],
})
export class OpdClinicalModule {}
