/**
 * Plain text + minimal HTML. Link only — never a password.
 */

export function activationEmail(link: string): { subject: string; text: string; html: string } {
  const subject = 'Activate your Hospigo account';
  const text = `Activate your Hospigo account by opening this link:\n\n${link}\n\nIf you did not expect this email, you can ignore it.`;
  const html = `<p>Activate your Hospigo account by opening this link:</p><p><a href="${escapeAttr(link)}">${escapeHtml(link)}</a></p><p>If you did not expect this email, you can ignore it.</p>`;
  return { subject, text, html };
}

export function passwordResetEmail(link: string): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = 'Reset your Hospigo password';
  const text = `Reset your Hospigo password by opening this link:\n\n${link}\n\nIf you did not request a reset, you can ignore this email.`;
  const html = `<p>Reset your Hospigo password by opening this link:</p><p><a href="${escapeAttr(link)}">${escapeHtml(link)}</a></p><p>If you did not request a reset, you can ignore this email.</p>`;
  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
