import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { NumberingModule } from '../numbering/numbering.module';
import { DailyCollectionService } from './daily-collection.service';
import { OpdReportsController } from './opd-reports.controller';

@Module({
  // NumberingModule exports the clock (CLOCK) that every OPD service uses for "today".
  imports: [AccessModule, NumberingModule],
  controllers: [OpdReportsController],
  providers: [DailyCollectionService],
})
export class OpdReportsModule {}
