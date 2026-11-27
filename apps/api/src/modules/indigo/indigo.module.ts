import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HealthModule } from '../health/health.module';
import { ImagesModule } from '../images/images.module';
import { PrintTemplatesModule } from '../print-templates/print-templates.module';
import { HqPrintService } from './hq-print.service';
import { HqMonitoringService } from './hq-monitoring.service';
import { HqPermissionsService } from './hq-permissions.service';
import { HqScopeService } from './hq-scope.service';
import { IndigoConsoleService } from './indigo-console.service';
import { IndigoController } from './indigo.controller';
import { IndigoLibraryController } from './indigo-library.controller';
import { IndigoLibraryService } from './indigo-library.service';
import { IndigoSetupService } from './indigo-setup.service';

@Module({
  imports: [AuthModule, HealthModule, ImagesModule, PrintTemplatesModule],
  controllers: [IndigoController, IndigoLibraryController],
  providers: [
    HqPrintService,
    HqMonitoringService,
    HqScopeService,
    HqPermissionsService,
    IndigoConsoleService,
    IndigoLibraryService,
    IndigoSetupService,
  ],
})
export class IndigoModule {}
