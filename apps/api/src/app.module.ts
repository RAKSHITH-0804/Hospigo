import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envFilePath, validateEnv } from './config/env';
import { PrismaModule } from './database/prisma.module';
import { AccessModule } from './modules/access/access.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ImportsModule } from './modules/imports/imports.module';
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
    AccessModule,
    StorageModule,
    HealthModule,
    PatientsModule,
    ImportsModule,
  ],
})
export class AppModule {}
