import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { HqPrismaService } from '../../database/hq-prisma.service';
import { MailModule } from '../mail/mail.module';
import { MailProcessor } from '../mail/mail.processor';
import { ActionTokenService } from './action-token.service';
import { AuthController } from './auth.controller';
import { AuthEmailService } from './auth-email.service';
import { AuthGuard } from './auth.guard';
import { AuthRedisService } from './auth-redis.service';
import { AuthService } from './auth.service';
import { HospitalLoginHelper } from './hospital-login.helper';
import { MembershipHelper } from './membership.helper';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/**
 * Auth endpoints (Step 6a-2 + 6b email flows). AuthGuard is registered globally via APP_GUARD.
 * HqPrismaService is provided here only; do not import it from other modules.
 */
@Module({
  imports: [MailModule],
  controllers: [AuthController],
  providers: [
    PasswordService,
    TokenService,
    AuthGuard,
    MembershipHelper,
    HospitalLoginHelper,
    HqPrismaService,
    AuthRedisService,
    AuthService,
    ActionTokenService,
    AuthEmailService,
    MailProcessor,
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
  exports: [
    PasswordService,
    TokenService,
    AuthGuard,
    AuthRedisService,
    MembershipHelper,
    HospitalLoginHelper,
    ActionTokenService,
    AuthEmailService,
  ],
})
export class AuthModule {}
