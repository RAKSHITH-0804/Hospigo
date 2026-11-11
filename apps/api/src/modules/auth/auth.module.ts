import { Module } from '@nestjs/common';
import { HqPrismaService } from '../../database/hq-prisma.service';
import { AuthGuard } from './auth.guard';
import { HospitalLoginHelper } from './hospital-login.helper';
import { MembershipHelper } from './membership.helper';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/**
 * Auth foundation (Step 6a-1). No login/refresh/logout controllers yet.
 * AuthGuard is exported for per-controller use — not registered globally.
 * HqPrismaService is provided here only; do not import it from other modules.
 * Access tokens use jsonwebtoken (HS256 only).
 */
@Module({
  providers: [
    PasswordService,
    TokenService,
    AuthGuard,
    MembershipHelper,
    HospitalLoginHelper,
    HqPrismaService,
  ],
  exports: [PasswordService, TokenService, AuthGuard, MembershipHelper, HospitalLoginHelper],
})
export class AuthModule {}
