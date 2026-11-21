import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envFilePath, validateEnv } from './config/env';
import { PrismaModule } from './database/prisma.module';
import { AccessModule } from './modules/access/access.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ImportsModule } from './modules/imports/imports.module';
import { PatientAuthModule } from './modules/patient-auth/patient-auth.module';
import { NumberingModule } from './modules/numbering/numbering.module';
import { DoctorProfilesModule } from './modules/doctor-profiles/doctor-profiles.module';
import { HospitalSettingsModule } from './modules/hospital-settings/hospital-settings.module';
import { OpdMastersModule } from './modules/opd-masters/opd-masters.module';
import { OpdClinicalModule } from './modules/opd-clinical/opd-clinical.module';
import { OpdInvestigationsModule } from './modules/opd-investigations/opd-investigations.module';
import { OpdRefundsModule } from './modules/opd-refunds/opd-refunds.module';
import { OpdReportsModule } from './modules/opd-reports/opd-reports.module';
import { PrintTemplatesModule } from './modules/print-templates/print-templates.module';
import { OpdVisitsModule } from './modules/opd-visits/opd-visits.module';
import { PatientsModule } from './modules/patients/patients.module';
import { StorageModule } from './modules/storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: envFilePath(),
      validate: validateEnv,
    }),
    PrismaModule,
    AuthModule,
    PatientAuthModule,
    AccessModule,
    StorageModule,
    HealthModule,
    PatientsModule,
    ImportsModule,
    OpdMastersModule,
    HospitalSettingsModule,
    DoctorProfilesModule,
    NumberingModule,
    OpdVisitsModule,
    OpdClinicalModule,
    OpdInvestigationsModule,
    OpdRefundsModule,
    OpdReportsModule,
    PrintTemplatesModule,
  ],
})
export class AppModule {}
