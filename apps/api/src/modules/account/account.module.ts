import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { StaffOtpService } from './staff-otp.service';

@Module({
  imports: [AuthModule, MailModule],
  controllers: [AccountController],
  providers: [AccountService, StaffOtpService],
})
export class AccountModule {}
