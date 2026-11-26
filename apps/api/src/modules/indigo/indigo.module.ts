import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IndigoConsoleService } from './indigo-console.service';
import { IndigoController } from './indigo.controller';

@Module({
  imports: [AuthModule],
  controllers: [IndigoController],
  providers: [IndigoConsoleService],
})
export class IndigoModule {}
