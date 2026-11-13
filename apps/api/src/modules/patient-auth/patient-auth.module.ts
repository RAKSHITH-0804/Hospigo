import { Module } from '@nestjs/common';
import { PatientPrismaService } from '../../database/patient-prisma.service';
import { AuthModule } from '../auth/auth.module';
import { MessagingModule } from '../messaging/messaging.module';
import { PatientAuthController } from './patient-auth.controller';
import { PatientAuthService } from './patient-auth.service';

/**
 * Patient OTP login (Step 6c). PatientPrismaService is provided here only.
 * Reuses AuthRedisService + TokenService from AuthModule.
 */
@Module({
  imports: [AuthModule, MessagingModule],
  controllers: [PatientAuthController],
  providers: [PatientPrismaService, PatientAuthService],
})
export class PatientAuthModule {}
