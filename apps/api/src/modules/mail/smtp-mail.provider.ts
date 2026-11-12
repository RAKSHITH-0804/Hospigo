import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { ApiEnv } from '../../config/env';
import type { MailProvider } from './mail.provider';
import type { MailMessage } from './mail.types';

@Injectable()
export class SmtpMailProvider implements MailProvider {
  private readonly logger = new Logger(SmtpMailProvider.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService<ApiEnv, true>) {
    const host = config.getOrThrow('SMTP_HOST', { infer: true });
    const port = config.getOrThrow('SMTP_PORT', { infer: true });
    const user = config.getOrThrow('SMTP_USER', { infer: true });
    const pass = config.getOrThrow('SMTP_PASSWORD', { infer: true });
    const secure = config.getOrThrow('SMTP_SECURE', { infer: true });
    this.from = config.getOrThrow('SMTP_FROM', { infer: true });
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    this.logger.log(`Mail sent subject=${message.subject}`);
  }
}
