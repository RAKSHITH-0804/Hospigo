import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HqScopeService } from './hq-scope.service';
import { IndigoConsoleService } from './indigo-console.service';
import { IndigoController } from './indigo.controller';
import { IndigoLibraryController } from './indigo-library.controller';
import { IndigoLibraryService } from './indigo-library.service';
import { IndigoSetupService } from './indigo-setup.service';

@Module({
  imports: [AuthModule],
  controllers: [IndigoController, IndigoLibraryController],
  providers: [HqScopeService, IndigoConsoleService, IndigoLibraryService, IndigoSetupService],
})
export class IndigoModule {}
