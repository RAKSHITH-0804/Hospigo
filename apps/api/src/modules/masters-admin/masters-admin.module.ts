import { Module } from '@nestjs/common';
import { CLOCK, SystemClock } from '../../common/clock';
import { MastersAdminController } from './masters-admin.controller';
import { PaymentModesService } from './payment-modes.service';
import { VitalsFieldsService } from './vitals-fields.service';

@Module({
  controllers: [MastersAdminController],
  providers: [{ provide: CLOCK, useClass: SystemClock }, PaymentModesService, VitalsFieldsService],
})
export class MastersAdminModule {}
