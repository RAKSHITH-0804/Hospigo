import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { NumberingModule } from '../numbering/numbering.module';
import { ConsultationService } from './consultation.service';
import { OpdClinicalController } from './opd-clinical.controller';
import { VitalsService } from './vitals.service';

@Module({
  imports: [AccessModule, NumberingModule],
  controllers: [OpdClinicalController],
  providers: [ConsultationService, VitalsService],
})
export class OpdClinicalModule {}
