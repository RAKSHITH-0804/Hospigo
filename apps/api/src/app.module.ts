import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envFilePath, validateEnv } from './config/env';
import { PrismaModule } from './database/prisma.module';
import { HealthModule } from './modules/health/health.module';
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
    StorageModule,
    HealthModule,
    PatientsModule,
  ],
})
export class AppModule {}
