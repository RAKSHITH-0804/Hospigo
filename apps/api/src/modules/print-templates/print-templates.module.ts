import { Module } from '@nestjs/common';
import { CLOCK, SystemClock } from '../../common/clock';
import { AccessModule } from '../access/access.module';
import { ImagesModule } from '../images/images.module';
import { PrintLibraryController } from './print-library.controller';
import { PrintLibraryService } from './print-library.service';
import { PrintTemplatesController } from './print-templates.controller';
import { PrintTemplatesService } from './print-templates.service';
import { PrintValuesController } from './print-values.controller';
import { PrintValuesService } from './print-values.service';

@Module({
  imports: [AccessModule, ImagesModule],
  controllers: [PrintTemplatesController, PrintValuesController, PrintLibraryController],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    PrintTemplatesService,
    PrintValuesService,
    PrintLibraryService,
  ],
})
export class PrintTemplatesModule {}
