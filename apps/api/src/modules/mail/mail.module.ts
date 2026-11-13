import { Module } from '@nestjs/common';
import { MAIL_PROVIDER } from './mail.provider';
import { MailService } from './mail.service';
import { SmtpMailProvider } from './smtp-mail.provider';

/**
 * SMTP transport + BullMQ enqueue. The Worker (MailProcessor) lives in AuthModule
 * so it can reuse ActionTokenService without a circular import.
 */
@Module({
  providers: [
    MailService,
    SmtpMailProvider,
    { provide: MAIL_PROVIDER, useExisting: SmtpMailProvider },
  ],
  exports: [MailService, MAIL_PROVIDER],
})
export class MailModule {}
