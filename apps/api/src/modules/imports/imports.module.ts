import { Module } from '@nestjs/common';
import { PatientsModule } from '../patients/patients.module';
import { ImportBatchService } from './import-batch.service';

@Module({
  imports: [PatientsModule],
  providers: [ImportBatchService],
  exports: [ImportBatchService],
})
export class ImportsModule {}
