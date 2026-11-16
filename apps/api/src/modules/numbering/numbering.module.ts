import { Module } from '@nestjs/common';
import { CLOCK, SystemClock } from '../../common/clock';
import { NumberSeriesService } from './number-series.service';
import { TokenCounterService } from './token-counter.service';

@Module({
  providers: [{ provide: CLOCK, useClass: SystemClock }, NumberSeriesService, TokenCounterService],
  exports: [NumberSeriesService, TokenCounterService, CLOCK],
})
export class NumberingModule {}
