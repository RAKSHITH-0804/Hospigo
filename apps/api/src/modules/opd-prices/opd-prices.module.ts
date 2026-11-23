import { Module } from '@nestjs/common';
import { CLOCK, SystemClock } from '../../common/clock';
import { OpdPricesController } from './opd-prices.controller';
import { PricesService } from './prices.service';

@Module({
  controllers: [OpdPricesController],
  providers: [{ provide: CLOCK, useClass: SystemClock }, PricesService],
  exports: [PricesService],
})
export class OpdPricesModule {}
