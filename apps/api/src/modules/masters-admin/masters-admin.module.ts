import { Module } from '@nestjs/common';
import { CLOCK, SystemClock } from '../../common/clock';
import { MastersAdminController } from './masters-admin.controller';
import { AccessModule } from '../access/access.module';
import { NumberSeriesAdminService } from './number-series-admin.service';
import { PaymentModesService } from './payment-modes.service';
import { VitalsFieldsService } from './vitals-fields.service';

@Module({
  imports: [AccessModule],
  controllers: [MastersAdminController],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    PaymentModesService,
    VitalsFieldsService,
    NumberSeriesAdminService,
  ],
})
export class MastersAdminModule {}
