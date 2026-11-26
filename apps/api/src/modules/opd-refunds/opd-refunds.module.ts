import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { NumberingModule } from '../numbering/numbering.module';
import { OpdRefundsController } from './opd-refunds.controller';
import { RefundsService } from './refunds.service';

@Module({
  imports: [AccessModule, NumberingModule],
  controllers: [OpdRefundsController],
  providers: [RefundsService],
})
export class OpdRefundsModule {}
