import { Module } from '@nestjs/common';
import { CLOCK, SystemClock } from '../../common/clock';
import { AccessModule } from '../access/access.module';
import { PrintTemplatesController } from './print-templates.controller';
import { PrintTemplatesService } from './print-templates.service';
import { PrintValuesController } from './print-values.controller';
import { PrintValuesService } from './print-values.service';

@Module({
  imports: [AccessModule],
  controllers: [PrintTemplatesController, PrintValuesController],
  providers: [{ provide: CLOCK, useClass: SystemClock }, PrintTemplatesService, PrintValuesService],
})
export class PrintTemplatesModule {}
