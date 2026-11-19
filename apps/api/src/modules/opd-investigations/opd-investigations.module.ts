import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { NumberingModule } from '../numbering/numbering.module';
import { InvestigationsService } from './investigations.service';
import { OpdInvestigationsController } from './opd-investigations.controller';

@Module({
  imports: [AccessModule, NumberingModule],
  controllers: [OpdInvestigationsController],
  providers: [InvestigationsService],
})
export class OpdInvestigationsModule {}
