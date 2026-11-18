import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { NumberingModule } from '../numbering/numbering.module';
import { OpdMastersModule } from '../opd-masters/opd-masters.module';
import { OpdVisitsController } from './opd-visits.controller';
import { OpdVisitsService } from './opd-visits.service';

@Module({
  imports: [AccessModule, NumberingModule, OpdMastersModule],
  controllers: [OpdVisitsController],
  providers: [OpdVisitsService],
})
export class OpdVisitsModule {}
