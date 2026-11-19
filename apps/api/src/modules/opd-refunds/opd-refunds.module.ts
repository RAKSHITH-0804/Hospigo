import { Module } from '@nestjs/common';
import { NumberingModule } from '../numbering/numbering.module';
import { OpdRefundsController } from './opd-refunds.controller';
import { RefundsService } from './refunds.service';

@Module({
  imports: [NumberingModule],
  controllers: [OpdRefundsController],
  providers: [RefundsService],
})
export class OpdRefundsModule {}
