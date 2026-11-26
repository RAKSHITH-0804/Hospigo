import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IndigoConsoleService } from './indigo-console.service';
import { IndigoController } from './indigo.controller';
import { IndigoLibraryController } from './indigo-library.controller';
import { IndigoLibraryService } from './indigo-library.service';
import { IndigoSetupService } from './indigo-setup.service';

@Module({
  imports: [AuthModule],
  controllers: [IndigoController, IndigoLibraryController],
  providers: [IndigoConsoleService, IndigoLibraryService, IndigoSetupService],
})
export class IndigoModule {}
