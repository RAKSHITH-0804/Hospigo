import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { OpdPricesModule } from '../opd-prices/opd-prices.module';
import { PatientsModule } from '../patients/patients.module';
import { ImportBatchService } from './import-batch.service';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [PatientsModule, AccessModule, OpdPricesModule],
  controllers: [ImportsController],
  providers: [ImportBatchService, ImportsService],
  exports: [ImportBatchService, ImportsService],
})
export class ImportsModule {}
