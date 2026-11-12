export type MailJobKind = 'ACTIVATION' | 'PASSWORD_RESET' | 'HQ_PASSWORD_RESET';

/** Queue payload — never includes secrets, tokens, or emails. */
export type MailJobData = {
  kind: MailJobKind;
  tenantId: string | null;
  userId: string;
};

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export const MAIL_QUEUE_NAME = 'mail';
