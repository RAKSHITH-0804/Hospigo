import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PrintTemplatesController } from './print-templates.controller';
import { PrintTemplatesService } from './print-templates.service';

@Module({
  imports: [AccessModule],
  controllers: [PrintTemplatesController],
  providers: [PrintTemplatesService],
})
export class PrintTemplatesModule {}
