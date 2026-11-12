import type { MailMessage } from './mail.types';

export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');

export interface MailProvider {
  send(message: MailMessage): Promise<void>;
}
